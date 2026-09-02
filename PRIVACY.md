# Article Saver — Privacy policy

Last updated: 2 September 2026

Article Saver is maintained by Barak Elisha. It saves articles, notes and lists on your device and offers optional Google Gemini summaries and chat.

## Data on your device

Article titles, source URLs, saved article text, lists, notes, chat history, language preferences and your optional Gemini API key are stored in the extension's local IndexedDB. The extension does not operate a developer backend, analytics service, advertising system or cloud synchronization service. Your API key is not encrypted separately from the browser profile; someone with access to that profile may be able to read it.

The extension reads page text only when you choose **Save current article**. In full-window mode it selects the most recently accessed HTTP/HTTPS tab in the current window when the extension's own tab is active. It does not continuously collect browsing history.

## Optional Google AI processing

AI summaries are off by default. If you enable automatic summaries, subsequent saves send the article title and up to 12,000 characters of its body directly to Google's Gemini API. Choosing **Regenerate** also sends this data. Sending a chat message sends the article title/body and up to the last 20 chat messages, including your message. Notes and the separate source-URL field are not included in AI requests; any personal information or URLs present inside article text or chat will be included.

Your API key authenticates these requests to Google. **Refresh models** sends the key to Google to list compatible models; it does not send your articles. Opening the extension and saving the key do not themselves contact Google. The extension developer does not receive your articles or API key through these requests.

Google processes requests under the terms applicable to your Gemini API account. Retention and data use may vary by service and account type. Review [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Google's privacy policy](https://policies.google.com/privacy) before sending sensitive material. API usage may count against your Google quota or incur charges.

## Export and external links

Excel exports contain your saved article metadata, summaries, notes and chats, but not the API key. The file is saved to the location you choose. Anyone you share it with can read its contents. Opening an article or other external link visits that website, whose own privacy policy applies.

## Your controls

- Leave automatic summaries disabled and do not use regenerate, chat or model refresh to avoid AI requests.
- Delete individual articles or lists using the extension controls. Deleting a list also deletes its articles, notes and chats.
- To remove the API key, clear the API key field and choose **Save key**.
- Removing the extension removes its local extension data from that browser profile. Separately exported files remain until you delete them.

The extension does not sell data, use data for advertising, or transfer data to the developer. Google AI processing occurs only through the optional actions described above.

## Contact and changes

Contact the maintainer through the [project's GitHub profile](https://github.com/Barak-elisha). For security concerns, follow [SECURITY.md](SECURITY.md) and avoid posting private articles or API keys publicly. Changes to this policy will be reflected in its date and repository history.
