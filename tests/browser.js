(async () => {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (error) { results.push({ name, status: 'FAIL', error: error.message }); }
    document.querySelector('#results').textContent = results.map(r => `${r.status} ${r.name}${r.error ? ': ' + r.error : ''}`).join('\n');
  };
  const parse = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content; };
  await test('Summary highlighter preserves text and formatting and restores read-only state', async () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<p>Keep <strong>this idea</strong> for later.</p><p>Another point.</p>';
    const before = editor.textContent;
    let savedHtml;
    const control = createHighlighter(editor, {label:'Summary', onSave:() => {savedHtml=sanitizeHtml(editor.innerHTML);}, onError:message => {throw Error(message);}});
    document.body.append(editor, control);
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges(); selection.addRange(range);
      control.querySelector('.icon-btn').click();
      control.querySelector('.marker-swatch').click();
      await Promise.resolve();
      assert(editor.textContent === before && editor.querySelector('strong'), 'Summary content or bold formatting changed');
      assert(!editor.hasAttribute('contenteditable'), 'Summary left editable');
      assert(savedHtml && savedHtml.includes('background-color'), 'Highlight not saved as sanitized formatting');
      editor.innerHTML = savedHtml;
      assert(editor.textContent === before && editor.querySelector('[style*="background-color"]'), 'Highlight lost on reload');
    } finally { editor.remove(); control.remove(); }
  });
  await test('Notes highlighter can remove a highlight while retaining editability', async () => {
    const editor = document.createElement('div'); editor.contentEditable='true';
    editor.innerHTML='<p><span style="background-color: rgb(255, 229, 138)">Marked note</span></p>';
    let saved=false;
    const control=createHighlighter(editor,{label:'Notes',onSave:()=>{saved=true;},onError:message=>{throw Error(message);}});
    document.body.append(editor,control);
    try {
      const range=document.createRange();range.selectNodeContents(editor);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      control.querySelector('.icon-btn').click();
      control.querySelector('[data-icon="eraser"]').click();
      await Promise.resolve();
      assert(saved && editor.contentEditable==='true','Notes not saved or no longer editable');
      assert(editor.textContent==='Marked note','Notes text changed');
      assert(!Array.from(editor.querySelectorAll('*')).some(el=>el.style.backgroundColor && el.style.backgroundColor!=='transparent'),'Highlight remains');
    } finally {editor.remove();control.remove();}
  });
  await test('Highlighter refuses a selection spanning another section', async () => {
    const editor=document.createElement('div'), outside=document.createElement('div');
    editor.textContent='Summary';outside.textContent='Notes';let message='',saved=false;
    const control=createHighlighter(editor,{label:'Summary',onSave:()=>{saved=true;},onError:value=>{message=value;}});
    document.body.append(editor,outside,control);
    try {
      const range=document.createRange();range.setStart(editor.firstChild,0);range.setEnd(outside.firstChild,5);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      control.querySelector('.icon-btn').click();control.querySelector('.marker-swatch').click();
      await Promise.resolve();
      assert(message && !saved && editor.innerHTML==='Summary' && outside.innerHTML==='Notes','Selection escaped its section');
    } finally {editor.remove();outside.remove();control.remove();}
  });
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
  await test('Excel preserves highlight colors, marked ranges and current summary HTML', async () => {
    const sample = [{...articles[0], summary:'Current summary', summaryHtmlSource:'Current summary',
      summaryHtml:'<p>Plain <span style="background-color:rgb(255, 235, 130)">Yellow <b>bold</b></span> gap <span style="background-color:#b8f2ca">Green</span></p>',
      notes:'<div>Note <span style="background-color:#123456">Dark custom</span> end</div>'},
      {...articles[1], summary:'New summary', summaryHtmlSource:'Old summary', summaryHtml:'<span style="background-color:yellow">Stale highlight</span>'}];
    const blob = await buildExcelBlob(sample, [{id:'one',name:'Highlights'},{id:'two',name:'Second'}]);
    const bytes = await blob.arrayBuffer();
    assert(await isWellFormedWorkbook(bytes), 'Malformed highlight workbook');
    const wb = XLSX.read(bytes, {type:'array',cellStyles:true});
    assert(wb.SheetNames.length === 4 && new Set(wb.SheetNames).size === 4, 'Highlights overwrote a list sheet');
    const excerpts = wb.Sheets[wb.SheetNames[3]];
    assert(excerpts.C2.v === 'Yellow bold' && excerpts.C3.v === 'Green' && excerpts.D4.v === 'Dark custom', 'Highlighted ranges lost or combined');
    for (const [address,color] of [['C2','FFEB82'],['C3','B8F2CA'],['D4','123456']]) {
      assert(excerpts[address].s.fgColor.rgb.endsWith(color), 'Original marker color missing: ' + address);
    }
    assert(!XLSX.utils.sheet_to_json(excerpts).some(row => JSON.stringify(row).includes('Stale highlight')), 'Stale summary exported');
    const zip = await JSZip.loadAsync(bytes);
    for (const number of [1,2]) {
      const doc = new DOMParser().parseFromString(await zip.file('xl/worksheets/sheet' + number + '.xml').async('string'), 'application/xml');
      const runs = [...doc.querySelectorAll('c[r="C2"] r')];
      assert(runs.some(r => r.querySelector('t')?.textContent === 'bold' && r.querySelector('b') && r.querySelector('u')), 'Summary formatting/range cue lost');
      assert(runs.some(r => r.querySelector('t')?.textContent === 'Plain ' && !r.querySelector('u')), 'Unmarked text marked');
      assert(doc.querySelector('c[r="D2"] u'), 'Notes range cue missing');
    }
    assert(wb.Sheets[wb.SheetNames[0]].C3.v === 'New summary', 'Old summary replaced current text');
  });
  await test('Saved on exports sortable numeric dates with local date and time on every sheet', async () => {
    const timestamp = new Date(2026, 8, 3, 23, 45, 12).getTime();
    const sample = [{...articles[0], savedAt:timestamp}, {...articles[1], savedAt:timestamp+86400000}];
    const blob = await buildExcelBlob(sample, [{id:'one',name:'First'},{id:'two',name:'Second'}]);
    const wb = XLSX.read(await blob.arrayBuffer(), {type:'array',cellNF:true});
    for (const name of wb.SheetNames) {
      const cell = wb.Sheets[name].G2;
      assert(cell.t === 'n' && typeof cell.v === 'number' && !cell.f, 'Date is text');
      assert(cell.z === 'dd/mm/yyyy hh:mm', 'Date format missing');
      const date = XLSX.SSF.parse_date_code(cell.v);
      assert(date.y === 2026 && date.m === 9 && [3,4].includes(date.d) && date.H === 23 && date.M === 45 && date.S === 12, 'Local date/time shifted');
    }
    const all = wb.Sheets[wb.SheetNames[0]];
    assert(Math.abs(all.G3.v - all.G2.v - 1) < 1e-8, 'Date arithmetic fails');
    for (const value of [null, undefined, '', 'invalid date']) assert(savedOnCell(value) === '', 'Missing date fabricated');
    assert(savedOnCell(0).t === 'n', 'Epoch date lost');
  });
  await test('Excel chat renders Markdown, paragraphs and speakers on the matching article in every sheet', async () => {
    const chat = [
      {role:'user', text:'על מה המאמר מדבר?'},
      {role:'assistant', text:'## Overview\r\n\r\n* **Security:** First topic.\r\n* **Culture:** Second topic.\r\n\r\n*Note: Only the provided article.*'},
      {role:'user', text:'מה זה המקור הזה'},
      {role:'assistant', text:'המקור הוא **ynet**.\n\nA & B <literal>\n1. First\n2. Second'}
    ];
    const sample = [
      {...articles[1], savedAt:3, chat:[{role:'assistant',text:'Other conversation'}]},
      {...articles[0], savedAt:2, chat},
      {...articles[0], id:'empty', savedAt:1, chat:[]}
    ];
    const blob = await buildExcelBlob(sample, [{id:'one',name:'First'},{id:'two',name:'Second'}]);
    const bytes = await blob.arrayBuffer();
    assert(await isWellFormedWorkbook(bytes), 'Malformed workbook');
    const zip = await JSZip.loadAsync(bytes);
    const wb = XLSX.read(bytes, {type:'array'});
    for (const sheetNumber of [1,2]) {
      const xml = await zip.file('xl/worksheets/sheet' + sheetNumber + '.xml').async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const cell = doc.querySelector('c[r="H3"]');
      assert(cell?.getAttribute('t') === 'inlineStr', 'Chat exported as plain text');
      const runs = [...cell.querySelectorAll('r')];
      const formatted = (text, tag) => runs.some(r => r.querySelector('t')?.textContent === text && r.querySelector('rPr ' + tag));
      assert(formatted('Security:', 'b') && formatted('ynet', 'b'), 'Bold missing');
      assert(formatted('Overview', 'b'), 'First-line heading missing');
      assert(formatted('Note: Only the provided article.', 'i'), 'Italic missing');
      assert(formatted(window.I18N.t('chatPrefixUser') + ':\n', 'b'), 'Speaker style missing');
      const text = wb.Sheets[wb.SheetNames[sheetNumber - 1]].H3.v;
      assert(text.includes('• Security: First topic.') && text.includes('• Culture: Second topic.'), 'Bullet list lost');
      assert(text.includes('Overview\n\n•') && text.includes('ynet.\n\nA & B <literal>'), 'Paragraphs/entities changed');
      assert(text.includes('1. First\n  2. Second'), 'Numbered list lost');
      assert(!text.includes('**') && !text.includes('*Note:') && !text.includes('Other conversation'), 'Raw markers or unrelated chat leaked');
      assert(!wb.Sheets[wb.SheetNames[sheetNumber - 1]].H2.v, 'Empty chat is no longer empty');
    }
    assert(wb.Sheets[wb.SheetNames[2]].H2.v.includes('Other conversation'), 'Per-list chat mapping changed');
  });
  await test('Excel headers use green styling and embedded icons on every sheet', async () => {
    const blob = await buildExcelBlob(articles, [{id:'one',name:'Research'}, {id:'two',name:'Reading'}]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    assert(await isWellFormedWorkbook(await blob.arrayBuffer()), 'Workbook XML is malformed');
    const styles = await zip.file('xl/styles.xml').async('string');
    assert(styles.includes('E3F6E7') && styles.includes('234D30') && styles.includes('CFE6D3'), 'Header colors missing');
    assert(styles.includes('indent="4"'), 'Icon space missing');
    const images = Object.keys(zip.files).filter(p => /xl\/media\/header-icon-\d+\.png$/.test(p));
    assert(images.length === 8, 'Eight embedded PNG icons required');
    for (let i = 1; i <= 3; i++) {
      const xml = await zip.file('xl/worksheets/sheet' + i + '.xml').async('string');
      assert(/<row[^>]*r="1"[^>]*ht="42"/.test(xml), 'Header row height missing');
      assert(xml.includes('<drawing r:id="headerIcons"/>'), 'Sheet has no header drawing');
      const drawing = await zip.file('xl/drawings/header-icons-' + i + '.xml').async('string');
      assert((drawing.match(/<xdr:oneCellAnchor>/g) || []).length === 8, 'Missing anchored icons');
    }
    const parsed = XLSX.read(await blob.arrayBuffer(), {type:'array'});
    assert(parsed.Sheets[parsed.SheetNames[0]].A1.v === window.I18N.t('excelList'), 'Header text is no longer editable text');
    assert(parsed.Sheets[parsed.SheetNames[0]].B2.v === '=1+1', 'Article data changed');
  });
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
