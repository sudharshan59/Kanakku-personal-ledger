const LEGACY_STORAGE_KEY = 'kanakku.entries';
const OFFLINE_STORAGE_KEY = 'kanakku.entries.offline';
const BALANCE_REFERENCE_AMOUNT = 1000;
const TOKEN_KEY = 'kanakku.googleToken';
const TOKEN_EXPIRY_KEY = 'kanakku.googleTokenExpiresAt';
const PROFILE_KEY = 'kanakku.profile';
const SESSION_KEY = 'kanakku.session';
const state = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), type: 'debit', showAll: false };
const $ = (id) => document.getElementById(id);
let entries = [];
let importQueue = [];
let pendingImport = null;

function showApp() { $('loginPage').classList.remove('visible'); $('appShell').classList.remove('app-hidden'); $('bottomNav').classList.remove('app-hidden'); }
function showLogin() { $('loginPage').classList.add('visible'); $('appShell').classList.add('app-hidden'); $('bottomNav').classList.add('app-hidden'); }
function activeEntryStorageKey() { const session = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); if (session.mode === 'google-drive' && session.email) return `kanakku.entries.google.${encodeURIComponent(session.email.toLowerCase())}`; return OFFLINE_STORAGE_KEY; }
function loadEntriesForActiveSession() { const key = activeEntryStorageKey(); let saved = localStorage.getItem(key); const session = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); if (saved === null && session.mode === 'google-drive') { saved = localStorage.getItem(LEGACY_STORAGE_KEY); if (saved !== null) { localStorage.setItem(key, saved); localStorage.removeItem(LEGACY_STORAGE_KEY); } } try { entries = JSON.parse(saved || '[]'); } catch (error) { entries = []; } }
function saveEntries() { localStorage.setItem(activeEntryStorageKey(), JSON.stringify(entries)); }
function continueOffline() { localStorage.setItem(SESSION_KEY, JSON.stringify({ mode:'offline', signedInAt:Date.now() })); loadEntriesForActiveSession(); showApp(); render(); }
function clearGoogleSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXPIRY_KEY); localStorage.removeItem(PROFILE_KEY); localStorage.removeItem(SESSION_KEY); }
function hasValidGoogleToken() { const token = localStorage.getItem(TOKEN_KEY); const expiresAt = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || 0); if (!token) return false; if (expiresAt && Date.now() >= expiresAt - 30000) { clearGoogleSession(); return false; } return true; }
function setSetupLoading(visible, title, status, progress) { $('setupLoader').classList.toggle('visible', visible); if (visible) { $('setupLoaderTitle').textContent = title; $('setupLoaderStatus').textContent = status; $('setupLoaderProgress').style.width = `${progress}%`; } }
function startGoogleLogin() { $('googleLoginButton').disabled = true; $('offlineLoginButton').disabled = true; setSetupLoading(true, 'Connecting Google', 'Opening secure Google login...', 20); if (window.Android) { window.Android.beginGoogleAuth(); } else { setSetupLoading(false); $('googleLoginButton').disabled = false; $('offlineLoginButton').disabled = false; window.alert('Google login is available in the Android APK.'); } }
async function driveRequest(url, options = {}) { const token = localStorage.getItem(TOKEN_KEY); if (!hasValidGoogleToken()) throw new Error('Google login required or expired'); const response = await fetch(url, { ...options, headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json', ...(options.headers || {}) } }); if (response.status === 401) { clearGoogleSession(); showLogin(); throw new Error('Google login expired'); } if (!response.ok) throw new Error(await response.text()); return response.json(); }
async function ensureDriveFolder(name, parentId) { const parent = parentId ? `'${parentId}' in parents and ` : ''; const query = `${parent}name='${name.replaceAll("'", "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`; const found = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`); if (found.files.length) return found.files[0].id; const body = { name, mimeType:'application/vnd.google-apps.folder' }; if (parentId) body.parents = [parentId]; return (await driveRequest('https://www.googleapis.com/drive/v3/files', { method:'POST', body:JSON.stringify(body) })).id; }
async function ensureMonthSheet(month, parentId) { const title = `Kanakku - ${new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month:'long', year:'numeric' })}`; const query = `'${parentId}' in parents and name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`; const found = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`); if (found.files.length) return found.files[0].id; const created = await driveRequest('https://sheets.googleapis.com/v4/spreadsheets', { method:'POST', body:JSON.stringify({ properties:{ title } }) }); await driveRequest(`https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}?addParents=${parentId}&removeParents=root&fields=id,parents`, { method:'PATCH', body:'{}' }); await driveRequest(`https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/Sheet1!A1:G1:append?valueInputOption=USER_ENTERED`, { method:'POST', body:JSON.stringify({ values:[['Received at','Date','Type','Amount','Category','Note','Entry ID']] }) }); return created.spreadsheetId; }
async function initializeGoogleAccount(token, expiresAt) { localStorage.setItem(TOKEN_KEY, token); if (expiresAt) localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt)); else localStorage.removeItem(TOKEN_EXPIRY_KEY); setSetupLoading(true, 'Checking Google account', 'Reading your Google profile...', 35); const user = await driveRequest('https://www.googleapis.com/oauth2/v3/userinfo'); setSetupLoading(true, 'Creating Drive folder', 'Creating your private Kanakku folder...', 52); const rootFolder = await ensureDriveFolder('Kanakku'); setSetupLoading(true, 'Creating account folder', `Preparing storage for ${user.email}...`, 68); const userFolder = await ensureDriveFolder(user.email, rootFolder); setSetupLoading(true, 'Preparing monthly sheet', `Creating your ${state.month.toLocaleDateString('en-IN', { month:'long', year:'numeric' })} sheet...`, 84); const sheetId = await ensureMonthSheet(currentMonthKey(), userFolder); localStorage.setItem(PROFILE_KEY, JSON.stringify({ name:user.name || user.email, email:user.email, id:user.sub })); localStorage.setItem(SESSION_KEY, JSON.stringify({ mode:'google-drive', signedInAt:Date.now(), email:user.email, rootFolderId:rootFolder, userFolderId:userFolder, sheetId, sheetMonth:currentMonthKey() })); return { user, sheetId }; }
window.onGoogleToken = async function(token, expiresAt) { try { setSetupLoading(true, 'Creating Drive folder', 'Setting up your private Kanakku folder...', 55); const result = await initializeGoogleAccount(token, expiresAt); loadEntriesForActiveSession(); setSetupLoading(true, 'Finishing setup', `Preparing ${state.month.toLocaleDateString('en-IN', { month:'long', year:'numeric' })} sheet...`, 85); await new Promise((resolve) => setTimeout(resolve, 350)); setSetupLoading(true, 'Ready', `Connected to ${result.user.email}`, 100); await new Promise((resolve) => setTimeout(resolve, 350)); showApp(); render(); syncInBackground(); } catch (error) { clearGoogleSession(); setSetupLoading(false); $('googleLoginButton').disabled = false; $('offlineLoginButton').disabled = false; window.alert(`Google setup failed: ${error.message}`); } };
window.onGoogleAuthError = function(message) { clearGoogleSession(); setSetupLoading(false); $('googleLoginButton').disabled = false; $('offlineLoginButton').disabled = false; window.alert(`Google authorization failed: ${message}`); };
window.onAutomaticTransactions = function(serializedCandidates) {
  try {
    const candidates = JSON.parse(serializedCandidates);
    if (Array.isArray(candidates)) {
      importQueue.push(...candidates.filter((candidate) => candidate && candidate.amount > 0 && candidate.type));
      showNextImportReview();
    }
  } catch (error) { console.warn('Could not read automatic transaction candidates.', error); }
};
window.onSmsImportPermission = function(granted) { updateAutoImportStatus(granted ? 'Bank SMS import is enabled. New transaction messages will be reviewed here.' : 'Bank SMS import was not enabled. You can still use notification import or add entries manually.'); };

const money = (value) => `Rs ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthKey = (date) => date.slice(0, 7);
const currentMonthKey = () => `${state.month.getFullYear()}-${String(state.month.getMonth() + 1).padStart(2, '0')}`;
const iconFor = (category) => ({ 'Food':'🍽', 'Bills':'🧾', 'EB Bill':'🧾', 'Rent':'🏠', 'Transfer':'↗', 'Salary':'↘', 'Travel':'✈', 'Shopping':'◈', 'Other':'•' }[category] || '•');
const monthEntries = () => entries.filter((entry) => monthKey(entry.date) === currentMonthKey()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

function render() {
  const list = monthEntries();
  const credits = list.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + Number(entry.amount), 0);
  const debits = list.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + Number(entry.amount), 0);
  const debitEntries = list.filter((entry) => entry.type === 'debit');
  const averageDebit = debitEntries.length ? debits / debitEntries.length : 0;
  const largestDebit = debitEntries.reduce((largest, entry) => Math.max(largest, Number(entry.amount)), 0);
  const categoryTotals = debitEntries.reduce((totals, entry) => { totals[entry.category] = (totals[entry.category] || 0) + Number(entry.amount); return totals; }, {});
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  const selectedMonthStart = `${currentMonthKey()}-01`;
  const openingBalance = entries.filter((entry) => entry.date < selectedMonthStart).reduce((sum, entry) => sum + (entry.type === 'credit' ? Number(entry.amount) : -Number(entry.amount)), 0);
  $('monthName').textContent = state.month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  $('entryCount').textContent = `${list.length} ${list.length === 1 ? 'entry' : 'entries'}`;
  const balance = openingBalance + credits - debits;
  $('balanceValue').textContent = money(balance);
  $('openingBalanceValue').textContent = money(openingBalance);
  $('monthCreditValue').textContent = money(credits);
  $('monthDebitValue').textContent = money(debits);
  $('balanceSyncStatus').textContent = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}').mode === 'google-drive' ? 'Synced to Drive' : 'Saved on device';
  $('insightsPeriod').textContent = state.month.toLocaleDateString('en-IN', { month: 'long' });
  $('averageDebitValue').textContent = money(averageDebit);
  $('averageDebitMeta').textContent = debitEntries.length ? `${debitEntries.length} ${debitEntries.length === 1 ? 'debit' : 'debits'}` : 'No debits yet';
  $('topCategoryValue').textContent = topCategory ? topCategory[0] : '—';
  $('topCategoryMeta').textContent = topCategory ? money(topCategory[1]) : 'No spending yet';
  $('largestDebitValue').textContent = money(largestDebit);
  $('largestDebitMeta').textContent = largestDebit ? 'Single transaction' : 'No debits yet';
  $('balanceLineFill').style.width = `${Math.min(100, Math.max(0, (balance / BALANCE_REFERENCE_AMOUNT) * 100))}%`;
  renderChart(list);
  $('transactionsList').innerHTML = (state.showAll ? list : list.slice(0, 6)).map((entry) => `<article class="transaction"><div class="transaction-icon">${iconFor(entry.category)}</div><div class="transaction-info"><b>${escapeHtml(entry.note)}</b><small>${entryMeta(entry)}</small></div><div class="transaction-amount ${entry.type}">${entry.type === 'credit' ? '+' : '-'}${money(entry.amount)}</div></article>`).join('');
  $('emptyState').style.display = list.length ? 'none' : 'flex';
  renderHistory();
}
function renderHistory() {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const credits = sorted.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + Number(entry.amount), 0);
  const debits = sorted.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + Number(entry.amount), 0);
  $('historySummary').innerHTML = `<span>All-time credit<b>${money(credits)}</b></span><span>All-time debit<b>${money(debits)}</b></span>`;
  const groups = sorted.reduce((result, entry) => { const key = monthKey(entry.date); (result[key] ||= []).push(entry); return result; }, {});
  $('historyList').innerHTML = Object.entries(groups).map(([key, group]) => {
    const monthCredits = group.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + Number(entry.amount), 0);
    const monthDebits = group.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + Number(entry.amount), 0);
    const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month:'long', year:'numeric' });
    return `<section class="history-month"><div class="history-month-heading"><h3>${monthName}</h3><div class="history-month-summary" aria-label="${monthName} totals"><span>Credit <b>${money(monthCredits)}</b></span><span>Debit <b>${money(monthDebits)}</b></span></div></div>${group.map((entry) => `<article class="transaction"><div class="transaction-icon">${iconFor(entry.category)}</div><div class="transaction-info"><b>${escapeHtml(entry.note)}</b><small>${entryMeta(entry)}</small></div><div class="transaction-amount ${entry.type}">${entry.type === 'credit' ? '+' : '-'}${money(entry.amount)}</div><button class="delete-button" type="button" data-entry-id="${escapeHtml(entry.id)}" aria-label="Delete ${escapeHtml(entry.note)}">×</button></article>`).join('')}</section>`;
  }).join('');
  $('historyEmpty').style.display = sorted.length ? 'none' : 'flex';
}
function renderChart(list) {
  const days = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate();
  const daily = Array.from({ length: days }, (_, index) => list.filter((entry) => entry.type === 'debit' && Number(entry.date.slice(-2)) === index + 1).reduce((sum, entry) => sum + Number(entry.amount), 0));
  const max = Math.max(...daily, 1);
  $('chart').innerHTML = daily.map((value, index) => `<span class="bar ${index + 1 === new Date().getDate() && currentMonthKey() === monthKey(new Date().toISOString().slice(0, 10)) ? 'today' : ''}" style="height:${Math.max(4, (value / max) * 100)}%" title="${index + 1}: ${money(value)}"></span>`).join('');
}
function formatDate(date) { return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
function formatTime(timestamp) { if (!timestamp) return '--:--'; return new Date(Number(timestamp)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
function entryMeta(entry) { return `${escapeHtml(entry.category)} · ${formatDate(entry.date)} · ${formatTime(entry.createdAt)}`; }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
function localDateInputValue() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function categoryForImport(candidate) { if (candidate.type === 'credit') return 'Salary'; const text = (candidate.note || '').toLowerCase(); if (text.includes('electric') || text.includes('eb ') || text.includes('bill')) return 'Bills'; if (text.includes('rent')) return 'Rent'; if (text.includes('travel') || text.includes('fuel')) return 'Travel'; if (text.includes('shop')) return 'Shopping'; return 'Transfer'; }
function showNextImportReview() { if (pendingImport || !$('importReviewDialog')) return; pendingImport = importQueue.shift(); if (!pendingImport) return; $('importReviewCopy').textContent = `${pendingImport.type === 'credit' ? 'Credit' : 'Debit'} of ${money(pendingImport.amount)} detected from ${pendingImport.source || 'your device'}.`; $('importNoteInput').value = String(pendingImport.note || 'Imported transaction').slice(0, 60); $('importCategoryInput').value = categoryForImport(pendingImport); $('importReviewDialog').showModal(); }
function closeImportReview() { if ($('importReviewDialog').open) $('importReviewDialog').close(); pendingImport = null; setTimeout(showNextImportReview, 0); }
window.handleAndroidBack = function() { const dialog = document.querySelector('dialog[open]'); if (!dialog) return false; if (dialog.id === 'importReviewDialog') closeImportReview(); else if (dialog.id === 'deleteConfirmDialog') closeDeleteConfirmation(); else dialog.close(); return true; };
function saveImportedEntry() { if (!pendingImport) return; const note = $('importNoteInput').value.trim(); if (!note) { $('importNoteInput').focus(); return; } const entry = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), type: pendingImport.type === 'credit' ? 'credit' : 'debit', amount: Number(pendingImport.amount), note: note.slice(0, 60), category: $('importCategoryInput').value, date: localDateInputValue(), createdAt: Number(pendingImport.receivedAt) || Date.now(), source: pendingImport.source || 'automatic' }; entries.push(entry); saveEntries(); render(); syncInBackground(); closeImportReview(); }
function updateAutoImportStatus(message) { if ($('autoImportStatus')) $('autoImportStatus').textContent = message; }
function enableNotificationImport() { if (!window.Android) { updateAutoImportStatus('Notification import is available in the Android APK.'); return; } window.Android.openNotificationAccessSettings(); updateAutoImportStatus('Allow Kanakku notification access in Android Settings, then return here.'); }
function enableSmsImport() { if (!window.Android) { updateAutoImportStatus('SMS import is available in the Android APK.'); return; } window.Android.requestSmsImport(); }
function openTransaction(type) { state.type = type; $('dialogTitle').textContent = type === 'credit' ? 'Add credit' : 'Add debit'; document.querySelectorAll('.type-option').forEach((button) => button.classList.toggle('active', button.dataset.type === type)); $('dateInput').value = localDateInputValue(); $('transactionDialog').showModal(); setTimeout(() => $('amountInput').focus(), 50); } /*
function scanReceipt() { if (!window.Android || !window.Android.scanReceipt) { setScanHomeStatus('Camera scanning is available in the Android APK.'); return; } setScanHomeStatus('Opening camera…'); window.Android.scanReceipt(state.type); }
*/ function saveEntry(event) { event.preventDefault(); const form = event.currentTarget; const entry = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), type: state.type, amount: Number($('amountInput').value), note: $('noteInput').value.trim(), category: $('categoryInput').value, date: $('dateInput').value, createdAt: Date.now() }; entries.push(entry); saveEntries(); form.reset(); $('transactionDialog').close(); render(); syncInBackground(); }
let syncPromise = null;
async function findExistingMonthSheet(month, parentId) { const title = `Kanakku - ${new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month:'long', year:'numeric' })}`; const query = `'${parentId}' in parents and name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`; const found = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`); return found.files && found.files.length ? found.files[0].id : null; }
async function ensureGoogleStorage() { if (!hasValidGoogleToken()) return null; const session = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); const email = profile.email || session.email; if (!email) throw new Error('Google account details are missing; please log in again.'); const rootFolderId = await ensureDriveFolder('Kanakku'); const userFolderId = await ensureDriveFolder(email, rootFolderId); const sheetMonth = currentMonthKey(); const sheetId = await ensureMonthSheet(sheetMonth, userFolderId); const nextSession = { ...session, mode:'google-drive', email, rootFolderId, userFolderId, sheetId, sheetMonth }; localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession)); return nextSession; }
async function syncEntries() { const storage = await ensureGoogleStorage(); if (!storage || !entries.length) return; const entriesByMonth = entries.reduce((groups, entry) => { const month = monthKey(entry.date); (groups[month] ||= []).push(entry); return groups; }, {}); for (const [month, monthEntriesForSheet] of Object.entries(entriesByMonth)) { const sheetId = month === storage.sheetMonth ? storage.sheetId : await ensureMonthSheet(month, storage.userFolderId); const existing = await driveRequest(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!G2:G`); const syncedIds = new Set((existing.values || []).map((row) => row[0]).filter(Boolean)); const pending = monthEntriesForSheet.filter((entry) => !syncedIds.has(entry.id)); if (!pending.length) continue; await driveRequest(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method:'POST', body:JSON.stringify({ values:pending.map((entry) => [new Date(entry.createdAt).toISOString(), entry.date, entry.type, entry.amount, entry.category, entry.note, entry.id]) }) }); } }
function syncInBackground() { if (syncPromise) return syncPromise; syncPromise = syncEntries().catch((error) => console.warn('Google background sync unavailable; entries remain saved locally.', error)).finally(() => { syncPromise = null; }); return syncPromise; }
async function deleteEntryFromSheet(entry) { if (!hasValidGoogleToken()) return false; let session = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); if (!session.userFolderId) session = await ensureGoogleStorage() || session; if (!session.userFolderId) return false; const sheetId = await findExistingMonthSheet(monthKey(entry.date), session.userFolderId); if (!sheetId) return false; const existing = await driveRequest(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!G2:G`); const rowIndexes = (existing.values || []).reduce((rows, row, index) => row[0] === entry.id ? rows.concat(index + 1) : rows, []); if (!rowIndexes.length) return false; const metadata = await driveRequest(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`); const sheet = (metadata.sheets || []).find((item) => item.properties && item.properties.title === 'Sheet1') || (metadata.sheets || [])[0]; if (!sheet || !sheet.properties || sheet.properties.sheetId === undefined) throw new Error('The monthly sheet tab could not be found.'); const tabId = Number(sheet.properties.sheetId); await driveRequest(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method:'POST', body:JSON.stringify({ requests:rowIndexes.sort((a, b) => b - a).map((startIndex) => ({ deleteDimension:{ range:{ sheetId:tabId, dimension:'ROWS', startIndex, endIndex:startIndex + 1 } } })) }) }); return true; }
let pendingDeleteEntryId = null;
function openDeleteConfirmation(entryId) { const entry = entries.find((item) => item.id === entryId); if (!entry) return; pendingDeleteEntryId = entry.id; $('deleteConfirmCopy').textContent = hasValidGoogleToken() ? `"${entry.note}" will be removed from this device and your connected Google Sheet.` : `"${entry.note}" will be removed from this device.`; $('deleteConfirmDialog').showModal(); }
function closeDeleteConfirmation() { pendingDeleteEntryId = null; if ($('deleteConfirmDialog').open) $('deleteConfirmDialog').close(); }
function confirmDelete() { const entryId = pendingDeleteEntryId; closeDeleteConfirmation(); if (entryId) deleteEntry(entryId); }
async function deleteEntry(entryId) { const entry = entries.find((item) => item.id === entryId); if (!entry) return; try { if (syncPromise) await syncPromise; await deleteEntryFromSheet(entry); entries = entries.filter((item) => item.id !== entryId); saveEntries(); render(); } catch (error) { window.alert(`Could not delete this entry from Google Sheets: ${error.message}`); } }
function saveSettings(event) { event.preventDefault(); const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); profile.name = $('settingsProfileInput').value.trim(); localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); $('settingsDialog').close(); }
$('addNavButton').addEventListener('click', () => openTransaction('debit')); $('settingsButton').addEventListener('click', openSettings); $('allTransactionsButton').addEventListener('click', () => { state.showAll = !state.showAll; $('allTransactionsButton').textContent = state.showAll ? 'Show less' : 'View all'; render(); }); $('previousMonth').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); state.showAll = false; render(); }); $('nextMonth').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); state.showAll = false; render(); }); $('transactionForm').addEventListener('submit', saveEntry); $('settingsForm').addEventListener('submit', saveSettings); document.querySelectorAll('.type-option').forEach((button) => button.addEventListener('click', () => { state.type = button.dataset.type; document.querySelectorAll('.type-option').forEach((option) => option.classList.toggle('active', option === button)); $('dialogTitle').textContent = state.type === 'credit' ? 'Add credit' : 'Add debit'; }));
function logout() { clearGoogleSession(); $('settingsDialog').close(); $('googleLoginButton').disabled = false; $('offlineLoginButton').disabled = false; setSetupLoading(false); showLogin(); }
function openSettings() { const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); $('settingsProfileInput').value = profile.name || ''; $('settingsAccountEmail').textContent = profile.email || 'Offline mode'; const smsEnabled = window.Android && window.Android.isSmsImportEnabled && window.Android.isSmsImportEnabled(); const notificationEnabled = window.Android && window.Android.isNotificationImportEnabled && window.Android.isNotificationImportEnabled(); const enabled = [smsEnabled ? 'SMS import' : '', notificationEnabled ? 'payment notifications' : ''].filter(Boolean); updateAutoImportStatus(enabled.length ? `${enabled.join(' and ')} ${enabled.length === 1 ? 'is' : 'are'} enabled. Manual entry is always available.` : 'Both import methods are optional. Manual entry is always available.'); $('settingsDialog').showModal(); }
function openHistory() { renderHistory(); $('historyDialog').showModal(); }
$('historyNavButton').addEventListener('click', openHistory);
$('historyList').addEventListener('click', (event) => { const button = event.target.closest('.delete-button'); if (button) openDeleteConfirmation(button.dataset.entryId); });
$('cancelDeleteButton').addEventListener('click', closeDeleteConfirmation);
$('confirmDeleteButton').addEventListener('click', confirmDelete);
$('enableNotificationsButton').addEventListener('click', enableNotificationImport);
$('enableSmsButton').addEventListener('click', enableSmsImport);
$('saveImportButton').addEventListener('click', saveImportedEntry);
$('skipImportButton').addEventListener('click', closeImportReview);
$('importReviewDialog').addEventListener('cancel', (event) => { event.preventDefault(); closeImportReview(); });
$('deleteConfirmDialog').addEventListener('cancel', (event) => { event.preventDefault(); closeDeleteConfirmation(); });
$('logoutButton').addEventListener('click', logout);
document.querySelectorAll('.close-button').forEach((button) => button.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const dialog = event.currentTarget.closest('dialog');
  if (dialog) {
    dialog.close();
    dialog.removeAttribute('open');
  }
}));
$('googleLoginButton').addEventListener('click', startGoogleLogin); $('offlineLoginButton').addEventListener('click', continueOffline);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncInBackground(); });
window.addEventListener('focus', syncInBackground);
const savedSession = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
if (savedSession.mode === 'offline' || hasValidGoogleToken()) { loadEntriesForActiveSession(); showApp(); } else { showLogin(); }
render();
syncInBackground();
