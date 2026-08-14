(() => {
  const $ = s => document.querySelector(s);
  const bytes = n => {
    n = Number(n || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  };

  async function call(path, extra = {}) {
    const familyId = localStorage.familyId;
    const parentPin = $('#parentPinInput')?.value?.trim();
    if (!familyId || !parentPin) throw new Error('פתח קודם את אזור ההורה עם הקוד');
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ familyId, parentPin, ...extra })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'request_failed');
    return d;
  }

  function render(audit) {
    const s = audit.summary;
    const incomplete = audit.characters.filter(c => !c.complete);
    const panel = $('#storageAuditResult');
    panel.innerHTML = `
      <div class="storageStats">
        <div><b>${s.completeCharacters}/${s.characters}</b><span>דמויות מלאות</span></div>
        <div><b>${s.r2Objects}</b><span>קבצים ב־R2</span></div>
        <div><b>${s.orphanedObjects}</b><span>קבצים מיותרים</span></div>
        <div><b>${bytes(s.orphanedBytes)}</b><span>ניתן לפנות</span></div>
      </div>
      ${audit.missing.length ? `<div class="storageWarn"><b>⚠️ חסרים ${audit.missing.length} קבצים פעילים</b><br>${audit.missing.map(x => `${x.name} — ${x.kind}`).join('<br>')}</div>` : '<div class="storageOk">✅ כל הקבצים שמופיעים ב־D1 קיימים ב־R2</div>'}
      ${incomplete.length ? `<div class="storageWarn"><b>דמויות לא שלמות:</b><br>${incomplete.map(c => `${c.name}: ${c.presentFiles}/${c.expectedFiles}`).join('<br>')}</div>` : ''}
      ${audit.orphaned.length ? `<details><summary>הצג ${audit.orphaned.length} קבצים יתומים</summary><div class="orphanList">${audit.orphaned.map(o => `<code>${o.key}</code> <small>${bytes(o.size)}</small>`).join('<br>')}</div></details>` : '<div class="storageOk">✅ אין קבצים יתומים</div>'}
      <div class="storageTotal">סה״כ R2: <b>${bytes(s.totalBytes)}</b> · בשימוש: <b>${bytes(s.referencedBytes)}</b></div>
    `;
    $('#cleanupStorageBtn').classList.toggle('hidden', !audit.orphaned.length);
    $('#cleanupStorageBtn').dataset.keys = JSON.stringify(audit.orphaned.map(o => o.key));
  }

  async function audit() {
    const btn = $('#auditStorageBtn');
    btn.disabled = true;
    $('#storageAuditResult').textContent = 'בודק את D1 מול R2…';
    try { render(await call('/api/storage/audit')); }
    catch (e) { $('#storageAuditResult').textContent = `לא ניתן לבדוק: ${e.message}`; }
    finally { btn.disabled = false; }
  }

  async function cleanup() {
    const btn = $('#cleanupStorageBtn');
    const keys = JSON.parse(btn.dataset.keys || '[]');
    if (!keys.length) return;
    if (!confirm(`למחוק ${keys.length} קבצים שאינם משויכים לשום דמות? הפעולה אינה הפיכה.`)) return;
    btn.disabled = true;
    try {
      const result = await call('/api/storage/cleanup', { keys });
      alert(`נמחקו ${result.deleted} קבצים מיותרים`);
      await audit();
    } catch (e) { alert(`המחיקה נכשלה: ${e.message}`); }
    finally { btn.disabled = false; }
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('#auditStorageBtn')?.addEventListener('click', audit);
    $('#cleanupStorageBtn')?.addEventListener('click', cleanup);
  });
})();
