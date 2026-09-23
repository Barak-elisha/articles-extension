#!/usr/bin/env python3
"""Generate Chrome Web Store manifest translations for supported UI languages."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESCRIPTIONS = {
    'en': 'Save articles to lists, add notes and highlights, use AI summaries and chat, and export or share your reading library.',
    'he': 'שמרו מאמרים ברשימות, הוסיפו הערות ומרקרים, השתמשו בסיכומי AI ובצ׳אט, וייצאו או שתפו את ספריית הקריאה.',
    'zh_CN': '将文章保存到列表，添加笔记和高亮，使用 AI 摘要和聊天，并导出或分享您的阅读资料库。',
    'hi': 'लेखों को सूचियों में सहेजें, नोट्स और हाइलाइट जोड़ें, AI सारांश व चैट का उपयोग करें और अपनी लाइब्रेरी साझा करें।',
    'es': 'Guarda artículos en listas, añade notas y resaltados, usa resúmenes y chat con IA, y exporta o comparte tu biblioteca.',
    'ar': 'احفظ المقالات في قوائم، وأضف الملاحظات والتظليل، واستخدم ملخصات ودردشة الذكاء الاصطناعي، وصدّر مكتبتك أو شاركها.',
    'fr': 'Enregistrez des articles, ajoutez notes et surlignages, utilisez les résumés et le chat IA, puis exportez ou partagez.',
    'pt_BR': 'Salve artigos em listas, adicione notas e destaques, use resumos e chat com IA e exporte ou compartilhe sua biblioteca.',
    'de': 'Speichere Artikel in Listen, ergänze Notizen und Markierungen, nutze KI-Zusammenfassungen und Chat und teile deine Bibliothek.',
    'it': 'Salva articoli in elenchi, aggiungi note ed evidenziazioni, usa riepiloghi e chat IA, poi esporta o condividi la raccolta.',
    'ru': 'Сохраняйте статьи в списки, добавляйте заметки и выделения, используйте ИИ-сводки и чат, экспортируйте библиотеку.',
    'nl': 'Bewaar artikelen in lijsten, voeg notities en markeringen toe, gebruik AI-samenvattingen en chat, en deel je bibliotheek.',
    'cs': 'Ukládejte články do seznamů, přidávejte poznámky a zvýraznění, používejte AI souhrny a chat a sdílejte svou knihovnu.',
    'pl': 'Zapisuj artykuły na listach, dodawaj notatki i wyróżnienia, korzystaj z podsumowań AI i czatu oraz udostępniaj bibliotekę.',
    'ja': '記事をリストに保存し、メモやハイライトを追加。AI要約とチャットを使い、読書ライブラリを出力・共有できます。',
    'ko': '기사를 목록에 저장하고 메모와 하이라이트를 추가하세요. AI 요약과 채팅을 사용하고 읽기 자료를 내보내거나 공유할 수 있습니다.',
    'tr': 'Makaleleri listelere kaydedin, not ve vurgular ekleyin, AI özetleri ve sohbeti kullanın; kitaplığınızı paylaşın.',
    'id': 'Simpan artikel ke daftar, tambahkan catatan dan sorotan, gunakan ringkasan serta chat AI, lalu bagikan pustaka Anda.',
    'vi': 'Lưu bài viết vào danh sách, thêm ghi chú và đánh dấu, dùng tóm tắt và trò chuyện AI, rồi xuất hoặc chia sẻ thư viện.',
    'th': 'บันทึกบทความเป็นรายการ เพิ่มโน้ตและไฮไลต์ ใช้สรุปและแชต AI แล้วส่งออกหรือแชร์คลังบทความของคุณ',
}

for locale, description in DESCRIPTIONS.items():
    if len(description) > 132:
        raise SystemExit(f'{locale} description is {len(description)} characters')
    path = ROOT / '_locales' / locale / 'messages.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'appName': {'message': 'Article Saver', 'description': 'Extension name'},
        'appDescription': {'message': description, 'description': 'Chrome Web Store short description'},
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')

print(f'Generated {len(DESCRIPTIONS)} Chrome locale files')
