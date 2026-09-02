(async () => {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (error) { results.push({ name, status: 'FAIL', error: error.message }); }
    document.querySelector('#results').textContent = results.map(r => `${r.status} ${r.name}${r.error ? ': ' + r.error : ''}`).join('\n');
  };
  const parse = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content; };
  await test('Sanitizer blocks overlay CSS and extension class names', () => {
    const out = parse(sanitizeHtml('<div class="modal-overlay" style="position:fixed;inset:0;z-index:99999;color:red">Fake control</div>'));
    const node = out.querySelector('div');
    assert(!node.className && !node.style.position && !node.style.zIndex, 'Untrusted node retains overlay styling');
    assert(node.style.color === 'red' && node.textContent === 'Fake control', 'Legitimate color/text lost');
  });
  await test('Sanitizer blocks encoded CSS resource functions', () => {
    const out = sanitizeHtml('<span style="background: u\\72l(https://example.invalid/pixel);color:#123456">Text</span>');
    assert(!out.includes('example.invalid') && !out.includes('\\72'), 'Encoded remote resource survives');
  });
  await test('Sanitizer strips active markup and unsafe links', () => {
    const out = parse(sanitizeHtml('<svg onload="alert(1)"></svg><img src="" onerror="alert(1)"><script>alert(1)</script><a href="java&#x09;script:alert(1)" onclick="alert(1)">link</a>'));
    assert(!out.querySelector('script,svg,img,[onclick],[onerror],[onload]'), 'Active markup survives');
    assert(!out.querySelector('a').hasAttribute('href'), 'Unsafe scheme survives');
  });
  await test('Safe rich formatting and highlights survive', () => {
    const out = parse(sanitizeHtml('<p dir="rtl"><b>מודגש</b><i>italic</i><font color="#ff0000" size="7">large</font><span style="background-color: rgb(255, 229, 138);font-size:18px">highlight</span><a href="https://example.com" target="_self">link</a></p>'));
    assert(out.querySelector('b') && out.querySelector('i') && out.querySelector('font'), 'Formatting lost');
    assert(out.querySelector('span').style.backgroundColor, 'Highlight lost');
    assert(out.querySelector('a').target === '_blank' && out.querySelector('a').rel.includes('noreferrer'), 'Link can replace extension page');
  });
  await test('Paste is sanitized before entering the live editor; dropped HTML is blocked', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    protectRichTextEditor(editor);
    editor.focus();
    const selection = window.getSelection();
    selection.selectAllChildren(editor);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', '<b>Safe paste</b><span class="modal-overlay" style="position:fixed;inset:0">Text</span>');
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    assert(event.defaultPrevented, 'Default paste remains active');
    assert(editor.querySelector('b') && editor.textContent === 'Safe pasteText', 'Paste content lost');
    assert(!editor.querySelector('[class]') && !editor.innerHTML.includes('fixed'), 'Unsafe paste reached editor');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    editor.dispatchEvent(drop);
    assert(drop.defaultPrevented, 'Drop bypass remains active');
    editor.remove();
  });
  await test('New plain-text articles preserve literal markup and entities', () => {
    assert(typeof articleContentToHtml === 'function', 'Explicit plain-text boundary missing');
    const text = '<div style="position:fixed">literal</div> &copy; A & B\nsecond line';
    const out = parse(articleContentToHtml(text, 'text'));
    assert(!out.querySelector('div') && out.textContent.includes('&copy;'), 'Plain text interpreted as HTML');
    assert(out.querySelector('br'), 'Line breaks lost');
  });
  const articles = [
    {id:'a',listId:'one',title:'=1+1',summary:'**Summary**',notes:'<b>Note</b>',url:'https://example.com/a',savedAt:1,chat:[]},
    {id:'b',listId:'two',title:'Second list only',summary:'Other',notes:'',url:'https://example.com/b',savedAt:2,chat:[]}
  ];
  async function workbook(lists) {
    const blob = await buildExcelBlob(articles, lists);
    return XLSX.read(await blob.arrayBuffer(), {type:'array'});
  }
  await test('Excel accepts invalid, duplicate, reserved and long list names', async () => {
    for (const names of [['A/B:*?[]','A/B:*?[]'],['All articles','All articles'],['x'.repeat(40),'x'.repeat(40)],['__proto__','constructor'],[" 'trim' ", 'x'.repeat(30) + "'suffix"]]) {
      const wb=await workbook([{id:'one',name:names[0]},{id:'two',name:names[1]}]);
      assert(wb.SheetNames.length === 3, 'Missing list sheets');
      assert(new Set(wb.SheetNames.map(x=>x.toLowerCase())).size === 3, 'Duplicate sheet names');
      assert(wb.SheetNames.every(name => !/^'|'$/.test(name)), 'Invalid edge apostrophe');
    }
  });
  await test('Excel keeps identically named lists separate', async () => {
    const wb=await workbook([{id:'one',name:'Same'},{id:'two',name:'Same'}]);
    for (let i=1;i<3;i++) {
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[i]]);
      assert(rows.length===1, 'Articles leaked between same-name lists');
    }
  });
  await test('Excel treats formula-looking article text as a string', async () => {
    const wb=await workbook([{id:'one',name:'First'},{id:'two',name:'Second'}]);
    const cell=wb.Sheets[wb.SheetNames[0]].B2;
    assert(cell.t==='s' && !cell.f && cell.v==='=1+1', 'Formula interpreted');
  });
  await test('IndexedDB list deletion removes its articles only', async () => {
    assert(['127.0.0.1','localhost'].includes(location.hostname), 'Storage tests require isolated localhost origin');
    const first=await addList('QA temporary first'), second=await addList('QA temporary second');
    try {
      await addArticle({listId:first.id,title:'Delete me',content:'text',url:'https://example.com'});
      await addArticle({listId:second.id,title:'Keep me',content:'text',url:'https://example.com'});
      await deleteList(first.id);
      assert((await getArticlesByList(first.id)).length===0,'Orphaned articles');
      assert((await getArticlesByList(second.id)).length===1,'Unrelated article deleted');
    } finally { await deleteList(first.id); await deleteList(second.id); }
  });
  await test('Saving into a deleted list fails without orphaning an article', async () => {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('Tests require a local test origin');
    const list = await addList('Regression deleted destination');
    await deleteList(list.id);
    let rejected = false;
    try { await addArticle({ listId: list.id, title: 'Should not save', content: 'Test', url: '' }); }
    catch (_) { rejected = true; }
    assert(rejected, 'Missing list was accepted');
    assert(!(await getArticles()).some(a => a.listId === list.id), 'Orphan article remains');
  });
  const failures=results.filter(r=>r.status==='FAIL').length;
  document.querySelector('#results').textContent += `\n\n${results.length-failures}/${results.length} passed`;
  document.body.dataset.complete='true'; document.body.dataset.failures=String(failures);
})();
