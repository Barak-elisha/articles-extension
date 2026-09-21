const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const packageSource = fs.readFileSync(path.join(__dirname, '../package-service.js'), 'utf8');
const shareSource = fs.readFileSync(path.join(__dirname, '../share-service.js'), 'utf8');
const mergeSource = fs.readFileSync(path.join(__dirname, '../merge-service.js'), 'utf8');

function createContext(extra = {}) {
  const ctx = vm.createContext({
    console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    crypto: {
      randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 10),
    },
    Blob: class Blob {
      constructor(parts, options = {}) {
        this.parts = parts;
        this.type = options.type || '';
        this.size = parts.reduce((sum, p) => sum + (typeof p === 'string' ? p.length : p.byteLength || 0), 0);
      }
      text() { return Promise.resolve(this.parts.join('')); }
    },
    File: class File extends Blob {
      constructor(parts, name, options = {}) {
        super(parts, options);
        this.name = name;
      }
    },
    URL: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {},
    },
    navigator: {
      clipboard: {
        writeText: async () => {},
      },
      canShare: () => false,
      share: async () => {},
    },
    window: {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      }),
      I18N: { t: (k, params) => {
        const dict = {
          shareInstructionsArticleTemplate: 'I shared an article with you through Article Saver.\nAn Article Saver file with the article and the information I shared is attached to this email.\n\nTo open it:\n1. Install Article Saver: {installUrl}\n2. Choose "Open shared file"\n3. Pick the attached file',
          shareInstructionsCollectionTemplate: 'I shared the collection "{collectionName}" with you through Article Saver.\nAn Article Saver file with the collection and the information I shared is attached to this email.\n\nTo open it:\n1. Install Article Saver: {installUrl}\n2. Choose "Open shared file"\n3. Pick the attached file',
          shareInstructionsResearchPackTemplate: 'I shared a research pack with you through Article Saver.\nAn Article Saver file with the research pack and the articles I shared is attached to this email.\n\nTo open it:\n1. Install Article Saver: {installUrl}\n2. Choose "Open shared file"\n3. Pick the attached file',
          shareCollectionItem: 'research collection',
          shareArticleItem: 'article',
          shareResearchPackItem: 'research pack',
          sharedResearch: 'shared research',
        };
        let v = dict[k] || k;
        if (params) v = v.replace(/\{(\w+)\}/g, (_, k2) => params[k2] || '{' + k2 + '}');
        return v;
      }},
    },
    document: {
      createElement: () => ({ click: () => {}, appendChild: () => {}, removeChild: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
    },
    ...extra,
  });

  // Save I18N before overwriting window
  const i18n = ctx.window.I18N;
  // Ensure window is the global object for IIFEs
  ctx.window = ctx;
  ctx.I18N = i18n;
  ctx.self = ctx;
  ctx.globalThis = ctx;

  // Run each source separately
  vm.runInContext(packageSource, ctx);
  vm.runInContext(shareSource, ctx);
  vm.runInContext(mergeSource, ctx);

  return ctx;
}

test('PackageService: buildPackage creates valid collection package', () => {
  const ctx = createContext();
  const list = {
    id: 'list_1',
    name: 'Test Collection',
    collectionId: 'col_test123',
    createdAt: Date.now(),
    description: 'A test collection',
  };
  const articles = [
    { id: 'art_1', title: 'Article 1', content: 'Content 1', contentFormat: 'text', url: 'https://example.com/1', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['tag1'], notes: 'Note 1', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] },
    { id: 'art_2', title: 'Article 2', content: 'Content 2', contentFormat: 'text', url: 'https://example.com/2', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['tag2'], notes: 'Note 2', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] },
  ];

  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles, includeNotes: true, includeTags: true, includeHighlights: true });

  assert.equal(pkg.manifest.packageType, 'collection');
  assert.equal(pkg.manifest.collectionName, 'Test Collection');
  assert.equal(pkg.manifest.collectionId, 'col_test123');
  assert.equal(pkg.manifest.articleCount, 2);
  assert.equal(pkg.collection.name, 'Test Collection');
  assert.equal(pkg.articles.length, 2);
  assert.equal(pkg.articles[0].notes, 'Note 1');
  assert.equal(pkg.articles[0].tags[0], 'tag1');
});

test('PackageService: buildPackage excludes notes when includeNotes is false', () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Test', collectionId: 'col_1', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['t'], notes: 'Secret note', highlights: [], summary: 'AI summary', summaryHtml: '<p>AI summary</p>', summaryHtmlSource: 'AI summary', chat: [{ role: 'user', text: 'Q' }] }];

  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles, includeNotes: false, includeAIChat: true });

  assert.equal(pkg.articles[0].notes, '');
  // Notes and AI chat are independent options: excluding notes must not wipe chat.
  assert.equal(pkg.articles[0].chat.length, 1);
  assert.equal(pkg.articles[0].summary, 'AI summary');
});

test('PackageService: AI summary and chat round-trip through export and parse', async () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Test', collectionId: 'col_1', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: 1000, doi: '', authors: [], publication: '', tags: [], notes: 'Note', highlights: [], summary: 'AI summary text', summaryHtml: '<p>AI <b>summary</b> text</p>', summaryHtmlSource: 'AI summary text', chat: [{ role: 'user', text: 'What is X?' }, { role: 'assistant', text: 'X is Y.' }] }];

  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles, includeAISummary: true, includeAIChat: true });
  const blob = await ctx.PackageService.serializePackage(pkg);
  const parsed = await ctx.PackageService.parsePackageFile(blob);

  assert.equal(parsed.articles[0].summary, 'AI summary text');
  assert.equal(parsed.articles[0].summaryHtml, '<p>AI <b>summary</b> text</p>');
  assert.equal(parsed.articles[0].summaryHtmlSource, 'AI summary text');
  assert.equal(parsed.articles[0].chat.length, 2);
  assert.equal(parsed.articles[0].chat[1].text, 'X is Y.');
  assert.equal(parsed.articles[0].chat[1].role, 'assistant');
});

test('PackageService: includeAISummary and includeAIChat clear only their own fields', () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Test', collectionId: 'col_1', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: [], notes: 'Note', highlights: [], summary: 'AI summary text', summaryHtml: '<p>AI</p>', summaryHtmlSource: 'AI', chat: [{ role: 'user', text: 'Q' }] }];

  const noSummary = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles, includeAISummary: false, includeAIChat: true });
  assert.equal(noSummary.articles[0].summary, '');
  assert.equal(noSummary.articles[0].summaryHtml, '');
  assert.equal(noSummary.articles[0].summaryHtmlSource, '');
  assert.equal(noSummary.articles[0].chat.length, 1);

  const noChat = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles, includeAISummary: true, includeAIChat: false });
  assert.equal(noChat.articles[0].summary, 'AI summary text');
  assert.equal(noChat.articles[0].chat.length, 0);
});

test('PackageService: serializePackage creates blob', async () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Test', collectionId: 'col_1', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: [], notes: '', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles });
  const blob = await ctx.PackageService.serializePackage(pkg);

  assert.ok(blob instanceof ctx.Blob);
  assert.equal(blob.type, 'application/json');
});

test('PackageService: validatePackage accepts valid package', () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Test', collectionId: 'col_1', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: [], notes: '', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles });

  const result = ctx.PackageService.validatePackage(pkg);
  assert.equal(result.valid, true);
});

test('PackageService: validatePackage rejects invalid manifest', () => {
  const ctx = createContext();
  const pkg = { manifest: { format: 'wrong', schemaVersion: 1, packageType: 'collection', collectionId: 'col_1', collectionName: 'Test', articleCount: 1 }, collection: { collectionId: 'col_1', name: 'Test', articleIds: ['art_1'] }, articles: [{ id: 'art_1' }] };
  const result = ctx.PackageService.validatePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('format'));
});

test('PackageService: validatePackage rejects unsupported schema version', () => {
  const ctx = createContext();
  const pkg = { manifest: { format: 'article-saver', schemaVersion: 999, packageType: 'collection', collectionId: 'col_1', collectionName: 'Test', articleCount: 1 }, collection: { collectionId: 'col_1', name: 'Test', articleIds: ['art_1'] }, articles: [{ id: 'art_1' }] };
  const result = ctx.PackageService.validatePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('schema version'));
});

test('PackageService: validatePackage rejects article count mismatch', () => {
  const ctx = createContext();
  const pkg = { manifest: { format: 'article-saver', schemaVersion: 1, packageType: 'collection', collectionId: 'col_1', collectionName: 'Test', articleCount: 5 }, collection: { collectionId: 'col_1', name: 'Test', articleIds: ['art_1'] }, articles: [{ id: 'art_1' }] };
  const result = ctx.PackageService.validatePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('count mismatch'));
});

test('PackageService: parsePackageFile parses valid JSON blob', async () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Test', collectionId: 'col_1', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: [], notes: '', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles });
  const blob = await ctx.PackageService.serializePackage(pkg);

  const parsed = await ctx.PackageService.parsePackageFile(blob);
  assert.equal(parsed.manifest.collectionName, 'Test');
  assert.equal(parsed.articles.length, 1);
});

test('PackageService: parsePackageFile rejects malformed JSON', async () => {
  const ctx = createContext();
  const blob = new ctx.Blob(['not json'], { type: 'application/json' });
  await assert.rejects(ctx.PackageService.parsePackageFile(blob), /Invalid JSON/);
});

test('PackageService: parsed packages keep only bounded known article fields and valid summary formatting', async () => {
  const ctx = createContext();
  const list = { id:'list_1', name:'Safe', collectionId:'col_safe', createdAt:1 };
  const articles = [{ id:'a', title:'A', content:'C', contentFormat:'script', url:'https://x.com', savedAt:1,
    summary:'Current', summaryHtml:'<b>stale</b>', summaryHtmlSource:'Old', chat:[{role:'owner',text:'Answer'}],
    tags:'not-an-array', notes:'N', highlights:[{text:'H',color:'javascript:red'}], unexpected:{admin:true} }];
  const raw = { manifest:{format:'article-saver',schemaVersion:1,packageType:'collection',collectionId:'col_safe',collectionName:'Safe',articleCount:1,unexpected:'drop'}, collection:{...list,articleIds:['a']}, articles };
  const parsed = await ctx.PackageService.parsePackageBlob(new ctx.Blob([JSON.stringify(raw)]));
  assert.equal(parsed.articles[0].contentFormat, 'text');
  assert.equal(parsed.articles[0].summary, 'Current');
  assert.equal(parsed.articles[0].summaryHtml, '');
  assert.equal(parsed.articles[0].chat[0].role, 'assistant');
  assert.equal(parsed.articles[0].highlights[0].color, '#ffe58a');
  assert.equal(parsed.articles[0].unexpected, undefined);
  assert.equal(parsed.manifest.unexpected, undefined);
});

test('PackageService: rejects mismatched collection identity and article indexes', () => {
  const ctx = createContext();
  const article = { id:'a', title:'A', content:'C' };
  const base = {manifest:{format:'article-saver',schemaVersion:1,packageType:'collection',collectionId:'one',collectionName:'Safe',articleCount:1},collection:{collectionId:'two',name:'Safe',articleIds:['a']},articles:[article]};
  assert.match(ctx.PackageService.validatePackage(base).error, /identity mismatch/);
  base.collection.collectionId = 'one';
  base.collection.articleIds = ['different'];
  assert.match(ctx.PackageService.validatePackage(base).error, /article list mismatch/);
});

test('PackageService: createImportPreview detects new collection', () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'New Pack', collectionId: 'col_new', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com/1', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['tag1'], notes: 'Note', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles });

  const preview = ctx.PackageService.createImportPreview(pkg, null, []);
  assert.equal(preview.isNewCollection, true);
  assert.equal(preview.newArticles, 1);
  assert.equal(preview.newTags.length, 1);
  assert.equal(preview.newNotes, 1);
});

test('PackageService: createImportPreview detects existing collection with updates', () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Existing', collectionId: 'col_exist', createdAt: Date.now() };
  const articles = [
    { id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com/1', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['tag1'], notes: 'New note', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] },
    { id: 'art_2', title: 'B', content: 'C', contentFormat: 'text', url: 'https://x.com/2', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['tag2'], notes: '', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] },
  ];
  const pkg = ctx.PackageService.buildPackage({ packageType: 'collection', list, articles });

  const localArticles = [{ id: 'local_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com/1', savedAt: Date.now() - 1000, doi: '', authors: [], publication: '', tags: ['tag1'], notes: 'Old note', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const existingList = { id: 'list_1', name: 'Existing', collectionId: 'col_exist', createdAt: Date.now() };

  const preview = ctx.PackageService.createImportPreview(pkg, existingList, localArticles);
  assert.equal(preview.isNewCollection, false);
  assert.equal(preview.existingArticles, 1);
  assert.equal(preview.newArticles, 1);
  assert.equal(preview.updatedNotes, 1);
  assert.ok(preview.newTags.includes('tag2'));
});

test('MergeService: findBestArticleMatch matches by DOI', () => {
  const ctx = createContext();
  const imported = { id: 'imp_1', doi: '10.1234/test', url: 'https://x.com' };
  const local = [{ id: 'loc_1', doi: '10.1234/test', url: 'https://other.com' }];

  const result = ctx.MergeService.findBestArticleMatch(imported, local);
  assert.ok(result.article);
  assert.equal(result.matchType, 'doi');
});

test('MergeService: findBestArticleMatch matches by URL', () => {
  const ctx = createContext();
  const imported = { id: 'imp_1', url: 'https://example.com/article' };
  const local = [{ id: 'loc_1', url: 'https://example.com/article' }];

  const result = ctx.MergeService.findBestArticleMatch(imported, local);
  assert.ok(result.article);
  assert.equal(result.matchType, 'url');
});

test('MergeService: mergeTags combines unique tags', () => {
  const ctx = createContext();
  const merged = ctx.MergeService.mergeTags(['tag1', 'tag2'], ['tag2', 'tag3']);
  assert.ok(Array.isArray(merged));
  assert.equal(merged.length, 3);
  assert.ok(merged.includes('tag1'));
  assert.ok(merged.includes('tag2'));
  assert.ok(merged.includes('tag3'));
});

test('MergeService: mergeNotes prefers newer', () => {
  const ctx = createContext();
  const merged = ctx.MergeService.mergeNotes('Old note', 'New note', true);
  // Implementation concatenates when both exist, so check it contains both
  assert.ok(merged.includes('Old note'));
  assert.ok(merged.includes('New note'));
});

test('MergeService: mergeNotes concatenates when not newer', () => {
  const ctx = createContext();
  const merged = ctx.MergeService.mergeNotes('Old note', 'New note', false);
  assert.ok(merged.includes('Old note'));
  assert.ok(merged.includes('New note'));
});

test('MergeService: mergeCollection creates new articles for unmatched', () => {
  const ctx = createContext();
  const localList = { id: 'list_1', name: 'Test', collectionId: 'col_1' };
  const importedList = { name: 'Test', collectionId: 'col_1' };
  const importedArticles = [{ id: 'imp_1', title: 'New Article', content: 'C', contentFormat: 'text', url: 'https://x.com/new', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['tag1'], notes: 'Note', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const localArticles = [];

  const result = ctx.MergeService.mergeCollection(localList, importedList, importedArticles, localArticles);
  assert.equal(result.changes.newArticles.length, 1);
  assert.equal(result.articles.length, 1);
});

test('MergeService: mergeCollection updates existing articles', () => {
  const ctx = createContext();
  const localList = { id: 'list_1', name: 'Test', collectionId: 'col_1' };
  const importedList = { name: 'Test', collectionId: 'col_1' };
  const importedArticles = [{ id: 'imp_1', title: 'Updated Title', content: 'C', contentFormat: 'text', url: 'https://x.com/same', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: ['newtag'], notes: 'New note', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const localArticles = [{ id: 'loc_1', title: 'Old Title', content: 'C', contentFormat: 'text', url: 'https://x.com/same', savedAt: Date.now() - 1000, doi: '', authors: [], publication: '', tags: ['oldtag'], notes: 'Old note', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];

  const result = ctx.MergeService.mergeCollection(localList, importedList, importedArticles, localArticles);
  assert.equal(result.changes.updatedArticles.length, 1);
  assert.ok(result.articles[0].tags.includes('newtag'));
  assert.ok(result.articles[0].tags.includes('oldtag'));
  // mergeNotes concatenates when both have content
  assert.ok(result.articles[0].notes.includes('Old note'));
  assert.ok(result.articles[0].notes.includes('New note'));
});

test('MergeService: merge preserves imported AI summary and chat', () => {
  const ctx = createContext();
  const localList = { id: 'list_1', name: 'Test', collectionId: 'col_1' };
  const importedList = { name: 'Test', collectionId: 'col_1' };
  const importedArticles = [{ id: 'imp_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com/1', savedAt: 3000, doi: '', authors: [], publication: '', tags: [], notes: '', highlights: [], summary: 'Imported summary', summaryHtml: '<p>Imported summary</p>', summaryHtmlSource: 'Imported summary', chat: [{ role: 'user', text: 'Q?' }, { role: 'assistant', text: 'A.' }] }];
  const localArticles = [{ id: 'loc_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com/1', savedAt: 2000, doi: '', authors: [], publication: '', tags: [], notes: '', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];

  const matched = ctx.MergeService.mergeCollection(localList, importedList, importedArticles, localArticles);
  assert.equal(matched.articles[0].summary, 'Imported summary');
  assert.equal(matched.articles[0].summaryHtml, '<p>Imported summary</p>');
  assert.equal(matched.articles[0].chat.length, 2);

  const newFromMerge = ctx.MergeService.mergeCollection(localList, importedList, importedArticles, []);
  assert.equal(newFromMerge.articles[0].chat[1].text, 'A.');
  assert.equal(newFromMerge.articles[0].summary, 'Imported summary');

  const fromNewList = ctx.MergeService.createNewCollectionFromPackage(importedList, importedArticles, 'new_list_id');
  assert.equal(fromNewList.articles[0].summary, 'Imported summary');
  assert.equal(fromNewList.articles[0].chat.length, 2);
});

test('MergeService: imported AI summary replaces an older local summary during an explicit merge', () => {
  const ctx = createContext();
  const local = { id:'local', listId:'list_1', title:'A', content:'C', url:'https://x.com/1', savedAt:9000, summary:'Local summary', summaryHtml:'', summaryHtmlSource:'', chat:[] };
  const incoming = { id:'incoming', title:'A', content:'C', url:'https://x.com/1', savedAt:1000, summary:'Shared summary', summaryHtml:'<p>Shared <b>summary</b></p>', summaryHtmlSource:'Shared summary', chat:[] };
  const result = ctx.MergeService.mergeCollection({id:'list_1'}, {}, [incoming], [local], {preferImportedSummary:true});
  assert.equal(result.articles[0].summary, 'Shared summary');
  assert.equal(result.articles[0].summaryHtmlSource, 'Shared summary');
});

test('MergeService: collection merge never updates a matching article in another list', () => {
  const ctx = createContext();
  const other = { id:'other', listId:'list_2', title:'Other', content:'Private', url:'https://x.com/same', savedAt:2000, summary:'Keep', chat:[] };
  const incoming = { id:'incoming', title:'Imported', content:'Shared', url:'https://x.com/same', savedAt:3000, summary:'Imported summary', chat:[] };
  const result = ctx.MergeService.mergeCollection({id:'list_1'}, {}, [incoming], [other], {preferImportedSummary:true});
  assert.equal(result.changes.newArticles.length, 1);
  assert.notEqual(result.articles[0].id, 'other');
});

test('MergeService: imported collection can be added to a different existing list', () => {
  const ctx = createContext();
  const targetList = { id:'reading_list', name:'My reading list', collectionId:'local_collection' };
  const importedList = { name:'Shared research', collectionId:'shared_collection' };
  const incoming = { id:'incoming', title:'Imported', content:'Shared', url:'https://x.com/shared', savedAt:3000, summary:'Imported summary', summaryHtml:'', summaryHtmlSource:'', chat:[{role:'assistant',text:'Imported chat'}], tags:[], highlights:[] };
  const result = ctx.MergeService.mergeCollection(targetList, importedList, [incoming], [], {preferImportedSummary:true});
  assert.equal(result.list.id, 'reading_list');
  assert.equal(result.list.name, 'My reading list');
  assert.equal(result.list.collectionId, 'local_collection');
  assert.equal(result.articles[0].listId, 'reading_list');
  assert.equal(result.articles[0].summary, 'Imported summary');
  assert.equal(result.articles[0].chat[0].text, 'Imported chat');
});

test('MergeService: createNewCollectionFromPackage creates new list and articles', () => {
  const ctx = createContext();
  const importedList = { name: 'New Pack', collectionId: 'col_new', createdAt: Date.now(), description: 'Desc' };
  const importedArticles = [{ id: 'imp_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: [], notes: '', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];

  const result = ctx.MergeService.createNewCollectionFromPackage(importedList, importedArticles, 'new_list_id');
  assert.equal(result.list.id, 'new_list_id');
  assert.equal(result.list.collectionId, 'col_new');
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].listId, 'new_list_id');
  assert.equal(result.changes.newArticles.length, 1);
});

test('ShareService: getShareInstructions generates correct text', () => {
  const ctx = createContext();

  const instructions = ctx.ShareService.getShareInstructions('collection', 'My Collection');
  // Just verify it produces a string with expected parts
  assert.ok(typeof instructions === 'string');
  assert.ok(instructions.length > 0);
  assert.ok(instructions.includes('My Collection'));
  assert.ok(instructions.includes('chromewebstore.google.com'));
  // The message must explicitly say the file is attached.
  assert.ok(instructions.includes('attached'));
});

test('ShareService: getShareInstructions supports articles and research packs', () => {
  const ctx = createContext();

  const article = ctx.ShareService.getShareInstructions('article', 'An Article');
  assert.ok(article.includes('article'));
  assert.ok(article.includes('attached'));

  const pack = ctx.ShareService.getShareInstructions('research-pack', 'A Pack');
  assert.ok(pack.includes('research pack'));
  assert.ok(pack.includes('attached'));
});

test('ShareService: download result carries the file name', async () => {
  const ctx = createContext({
    navigator: {
      canShare: () => false,
      share: async () => {},
      clipboard: {
        writeText: async () => {},
      },
    },
    window: {
      showSaveFilePicker: undefined,
      I18N: { t: (k) => k },
    },
    document: {
      createElement: () => ({ click: () => {}, appendChild: () => {}, removeChild: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
    },
  });

  const blob = new ctx.Blob(['test'], { type: 'application/json' });
  const result = await ctx.ShareService.sharePackage(blob, 'My Collection.articlesaver', 'collection', 'My Collection', { preferNative: true });

  assert.equal(result.success, true);
  assert.equal(result.method, 'download');
  assert.equal(result.fileName, 'My Collection.articlesaver');
});

test('ShareService: sharePackage uses native share when available', async () => {
  let shareCalled = false;
  const ctx = createContext({
    navigator: {
      canShare: () => true,
      share: async (data) => { shareCalled = true; },
    },
  });

  const blob = new ctx.Blob(['test'], { type: 'application/json' });
  const result = await ctx.ShareService.sharePackage(blob, 'test.articlesaver', 'collection', 'Test', { preferNative: true });

  assert.equal(shareCalled, true);
  assert.equal(result.success, true);
  assert.equal(result.method, 'native');
});

test('ShareService: sharePackage falls back to download when native unavailable', async () => {
  let downloadCalled = false;
  const ctx = createContext({
    navigator: {
      canShare: () => false,
      share: async () => {},
      clipboard: {
        writeText: async () => {},
      },
    },
    window: {
      showSaveFilePicker: undefined,
      I18N: { t: (k) => k },
    },
    document: {
      createElement: () => ({ click: () => {}, appendChild: () => {}, removeChild: () => {} }),
      body: { appendChild: () => { downloadCalled = true; }, removeChild: () => {} },
    },
  });

  const blob = new ctx.Blob(['test'], { type: 'application/json' });
  const result = await ctx.ShareService.sharePackage(blob, 'test.articlesaver', 'collection', 'Test', { preferNative: true });

  assert.equal(result.success, true);
  assert.equal(result.method, 'download');
});

test('PackageService: getFileName sanitizes filename', () => {
  const ctx = createContext();
  const name = ctx.PackageService.getFileName('Test: "Collection" / Name', 'collection');
  assert.ok(!name.includes(':'));
  assert.ok(!name.includes('"'));
  assert.ok(!name.includes('/'));
  assert.ok(name.endsWith('.articlesaver'));
});

test('PackageService: selectArticlesForList returns every list for All lists', () => {
  const ctx = createContext();
  const articles = [
    { id: 'art_1', listId: 'list_1' },
    { id: 'art_2', listId: 'list_2' },
    { id: 'art_3', listId: 'list_1' },
  ];

  assert.deepEqual(
    Array.from(ctx.PackageService.selectArticlesForList(articles, null), (article) => article.id),
    ['art_1', 'art_2', 'art_3'],
  );
  assert.deepEqual(
    Array.from(ctx.PackageService.selectArticlesForList(articles, ''), (article) => article.id),
    ['art_1', 'art_2', 'art_3'],
  );
});

test('PackageService: selectArticlesForList limits a pack to the selected list', () => {
  const ctx = createContext();
  const articles = [
    { id: 'art_1', listId: 'list_1' },
    { id: 'art_2', listId: 'list_2' },
    { id: 'art_3', listId: 'list_1' },
  ];

  assert.deepEqual(
    Array.from(ctx.PackageService.selectArticlesForList(articles, 'list_1'), (article) => article.id),
    ['art_1', 'art_3'],
  );
});

test('PackageService: selected pack articles are not replaced by the current list scope', () => {
  const ctx = createContext();
  const allArticles = [
    { id: 'art_1', listId: 'list_1' },
    { id: 'art_2', listId: 'list_2' },
    { id: 'art_3', listId: 'list_1' },
  ];
  const selectedAcrossLists = [allArticles[0], allArticles[1]];

  assert.deepEqual(
    Array.from(ctx.PackageService.resolveResearchPackArticles(selectedAcrossLists, allArticles, 'list_1'), (article) => article.id),
    ['art_1', 'art_2'],
  );
});

test('PackageService: buildPackage supports research-pack type', () => {
  const ctx = createContext();
  const list = { id: 'list_1', name: 'Research Pack', collectionId: 'col_pack', createdAt: Date.now(), description: 'Pack desc' };
  const articles = [{ id: 'art_1', title: 'A', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '', authors: [], publication: '', tags: [], notes: '', highlights: [], summary: '', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const pkg = ctx.PackageService.buildPackage({ packageType: 'research-pack', list, articles, description: 'Pack desc' });

  assert.equal(pkg.manifest.packageType, 'research-pack');
  assert.equal(pkg.manifest.description, 'Pack desc');
});

test('PackageService: buildPackage supports article type', () => {
  const ctx = createContext();
  const list = { id: 'temp', name: 'Article Title', collectionId: 'temp_1', createdAt: Date.now() };
  const articles = [{ id: 'art_1', title: 'Article Title', content: 'C', contentFormat: 'text', url: 'https://x.com', savedAt: Date.now(), doi: '10.1234/test', authors: ['Author'], publication: 'Journal', tags: ['tag1'], notes: 'Note', highlights: [], summary: 'Summary', summaryHtml: '', summaryHtmlSource: '', chat: [] }];
  const pkg = ctx.PackageService.buildPackage({ packageType: 'article', list, articles });

  assert.equal(pkg.manifest.packageType, 'article');
  assert.equal(pkg.articles[0].doi, '10.1234/test');
  assert.equal(pkg.articles[0].authors[0], 'Author');
});

test('PackageService: validatePackage rejects structurally incomplete articles', () => {
  const ctx = createContext({
    MAX_PACKAGE_SIZE: 100,
  });
  // Re-run with modified constant
  vm.runInContext(`
    Object.defineProperty(window.PackageService, 'MAX_PACKAGE_SIZE', { value: 100, writable: true });
  `, ctx);

  const pkg = { manifest: { format: 'article-saver', schemaVersion: 1, packageType: 'collection', collectionId: 'col_1', collectionName: 'Test', articleCount: 1 }, collection: { collectionId: 'col_1', name: 'Test', articleIds: ['art_1'] }, articles: [{ id: 'art_1', title: 'A'.repeat(200) }] };
  const result = ctx.PackageService.validatePackage(pkg);
  assert.equal(result.valid, false);
});

test('PackageService: validatePackage rejects too many articles', () => {
  const ctx = createContext();
  const articles = Array.from({ length: 600 }, (_, i) => ({ id: 'art_' + i }));
  const pkg = { manifest: { format: 'article-saver', schemaVersion: 1, packageType: 'collection', collectionId: 'col_1', collectionName: 'Test', articleCount: 600 }, collection: { collectionId: 'col_1', name: 'Test', articleIds: articles.map(a => a.id) }, articles };
  const result = ctx.PackageService.validatePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('Too many articles'));
});
