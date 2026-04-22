# InsightStream

InsightStream is an enterprise-grade conversational data analytics platform that empowers users to query their BigQuery and Google Sheets data using natural language. It features a robust AI engine powered by Gemini 2.5 Pro for SQL generation and data synthesis.

## 🚀 Key Features

- **Conversational Analytics**: Translate natural language questions into complex BigQuery SQL queries.
- **Google SSO**: Secure OAuth 2.0 integration with persistent, encrypted sessions.
- **Multi-Source Data**: Direct integration with Google BigQuery (Schema detection) and Google Sheets.
- **Chat Management**: Persistent chat history and multi-session support.
- **Resource Monitoring**: Real-time AI token usage tracking.
- **Security First**: CSRF protection, rate limiting, and SQL safety guards.

## 🛠 Tech Stack

- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Lucide React, Motion (Framer Motion).
- **Backend**: Node.js, Express, TSX, Google Auth Library.
- **AI**: Google Gemini 2.5 Pro (SQL Generation) & Gemini 2.5 Flash (Synthesis).
- **Cloud**: Google Cloud (BigQuery, Google Drive, Google Sheets).

## 📂 Folder Structure

```text
.
├── api/                # Vercel serverless functions
├── components/         # Root UI components (shadcn/ui)
├── src/
│   ├── components/     # App-specific React components
│   ├── server/         # Express app factory (createApp.ts)
│   ├── constants/      # System prompts and default schemas
│   ├── hooks/          # Custom React hooks
│   ├── lib/            # Shared utility libraries
│   ├── types.ts        # TypeScript interfaces
│   ├── App.tsx         # Main application orchestration
│   └── main.tsx        # React entry point
├── server.ts           # Local development / Docker entry point
└── package.json        # Dependencies and scripts
```

## 🏗 Architecture

InsightStream follows a multi-stage pipeline for conversational analytics:

1.  **Natural Language Input**: User asks a question in the chat.
2.  **SQL Generation**: Gemini 2.5 Pro uses the detected BigQuery schema to generate a `SELECT` or `WITH` query.
3.  **Data Retrieval**: The generated SQL is executed against BigQuery using the user's OAuth credentials.
4.  **Synthesis & Visualization**: Gemini 2.5 Flash analyzes the raw results and suggests an appropriate chart (Bar, Line, Pie, or Table).

## 📋 Setup & Installation

### 1. Google OAuth Configuration
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **BigQuery API**, **Google Drive API**, and **Google Sheets API**.
3. Configure the **OAuth Consent Screen**.
4. Create **OAuth 2.0 Client IDs** (Web Application).
5. Add Authorized Redirect URIs pointing to your `/auth/callback` endpoint.

### 2. Environment Variables
Create a `.env` file based on `.env.example`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
BIGQUERY_PROJECT_ID=...
GEMINI_API_KEY=...
SESSION_SECRET=...
```

### 3. Development
```bash
npm install
npm run dev
```

## 🔒 Security & Privacy

- **SQL Safety**: Strict allowlist of SQL patterns (SELECT/WITH only) and row limits (500 rows).
- **CSRF Protection**: Double-submit cookie pattern for all state-changing API calls.
- **Rate Limiting**: Per-route group limiting to prevent abuse.
- **Data Minimization**: Session-based storage of OAuth tokens; no PII stored permanently.
