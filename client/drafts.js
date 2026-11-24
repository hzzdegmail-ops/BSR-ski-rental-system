const draftStorageKey='bsr.workbench.drafts.v1';
const draftLifetime=8*60*60*1000;
const contractDraftForms=['preview-return','exchange-choices'];
const assetDraftForms=['repair-submit','inspect-asset'];

function loadDrafts(owner) {
  try {
    const saved=JSON.parse(sessionStorage.getItem(draftStorageKey));
    if (saved?.owner===owner && Array.isArray(saved.entries)) {
      return saved.entries.filter(d=>d?.at>Date.now()-draftLifetime);
    }
    sessionStorage.removeItem(draftStorageKey);
  } catch {}
  return [];
}

function persistDrafts() {
  try {
    if (state.drafts.length) sessionStorage.setItem(draftStorageKey,JSON.stringify({owner:state.user.username,entries:state.drafts}));
    else sessionStorage.removeItem(draftStorageKey);
  } catch {}
}

function findDraft(form,id) {
  return state.drafts?.find(d=>d.form===form && d.id===id && d.at>Date.now()-draftLifetime);
}
function dropDrafts(forms,id) {
  state.drafts=(state.drafts||[]).filter(d=>d.id!==id || !forms.includes(d.form));
  persistDrafts();
}
function draftNote(draft) {
  return draft?`<small data-draft-note>草稿保存于 ${h(date(draft.at))}</small>`:'';
}

function rememberDraft(form) {
  const name=form.dataset.form;
  const id=assetDraftForms.includes(name)?state.equipmentId:state.returnContract?.contract.contract_id;
  if (!Number.isSafeInteger(id)) return;
  const fd=new FormData(form);
  const received=fd.getAll('received');
  fd.delete('received');
  fd.delete('confirm');
  const draft={form:name,id,received,fields:Object.fromEntries(fd),at:Date.now()};
  state.drafts=[draft,...(state.drafts||[]).filter(d=>d.id!==id || d.form!==name)].slice(0,40);
  persistDrafts();
  const note=form.querySelector('[data-draft-note]');
  if (note) note.textContent='草稿保存于 '+date(draft.at);
  else form.insertAdjacentHTML('afterbegin',draftNote(draft));
}
