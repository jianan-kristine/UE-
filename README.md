# CompLens - AI Competitive Analysis Tool

🔍 **CompLens** is an AI-powered competitive analysis platform that helps you discover insights about your product ideas by automatically researching and analyzing competitors.

## ✨ Features

- 🤖 **AI-Powered Analysis**: Uses DeepSeek AI to conduct comprehensive competitor research
- ⚡ **Dual Mode**: Quick feedback (2 min) or deep search (5 min) analysis
- 🌐 **Web Scraping**: Integrates Firecrawl for real-time competitor data gathering
- 🔒 **Tool Approval System**: Manual approval for API-heavy tool calls
- 📊 **Visual Reports**: Generate interactive visualizations from analysis
- 🌍 **Multi-language**: Supports English, Chinese, and Japanese
- 💾 **Report Management**: Save, view, and reanalyze reports
- ⏸️ **Interrupt & Resume**: Pause analysis and continue later with checkpoints

## 🚀 Quick Start

### Prerequisites

- [Deno](https://deno.land/) v1.40+ installed
- DeepSeek API key
- (Optional) Firecrawl API key for web scraping
- (Optional) Google Cloud Storage for file uploads

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/jianan-kristine/UE-.git
cd UE-
```

2. **Set up environment variables**

Create a `.env` file in the root directory:

```env
# Required: DeepSeek AI API Key
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# Optional: Firecrawl API Key (for web scraping)
FIRECRAWL_API_KEY=your_firecrawl_api_key_here

# Optional: Google Cloud Storage (for file uploads)
GOOGLE_APPLICATION_CREDENTIALS=./gcp-storage-key.json
GCS_BUCKET_NAME=your-bucket-name

# Optional: Configuration
MAX_TOOL_CALLS=5
MAX_ITERATIONS=20
ANALYSIS_TIMEOUT_MS=120000
```

3. **Get API Keys**

- **DeepSeek API**: Sign up at [DeepSeek](https://platform.deepseek.com/)
- **Firecrawl API** (optional): Sign up at [Firecrawl](https://firecrawl.dev/)
- **GCS** (optional): Create a service account in [Google Cloud Console](https://console.cloud.google.com/)

4. **Install dependencies**
```bash
deno cache server.ts
```

### Running the Application

```bash
# Development mode with auto-reload
deno task dev

# Production mode
deno task start
```

The server will start at **http://localhost:8001**

## 📖 Usage

### 1. Basic Analysis

1. Open http://localhost:8001 in your browser
2. Enter your product idea in the text area
3. Choose analysis mode:
   - **⚡ Quick Feedback**: Fast analysis (2 min, limited tools)
   - **🔍 Deep Search**: Comprehensive analysis (5 min, unlimited tools)
4. Click the analysis button and wait for results

### 2. Advanced Options

- **Persona**: Choose analysis perspective (Product Manager, Investor, Growth, Tech Lead)
- **Model**: Select AI model (DeepSeek Fast/Accurate)
- **Web Tools**: Enable/disable Firecrawl web scraping
- **Auto Continue**: Allow automatic report continuation
- **Tool Approval**: Require manual approval before calling Firecrawl

### 3. File Upload Analysis

1. Click "Or upload a file" section
2. Upload PDF, Word, TXT, or MD files
3. Add optional notes
4. Choose analysis mode and run

### 4. Report Management

- Click 📚 button (bottom right) to view history
- Click any report to view details
- Use "Continue Analysis" to resume interrupted reports
- Export reports for sharing

## 🛠️ API Endpoints

### Analysis
```bash
POST /api/analyze
Body: {
  "idea": "Your product idea",
  "mode": "quick" | "deep",
  "language": "en" | "zh" | "ja",
  "persona": "pm" | "vc" | "growth" | "tech",
  "model": "deepseek-fast" | "deepseek-accurate",
  "allowWebTools": true,
  "enableAutoContinue": true,
  "requireToolApproval": false
}
```

### File Analysis
```bash
POST /api/analyze-file
Content-Type: multipart/form-data
Fields: file, note, mode, language, persona, model
```

### Reports
```bash
GET  /api/reports          # List all reports
GET  /api/reports/:id      # Get report details
POST /api/reports/:id/reanalyze  # Reanalyze report
DELETE /api/reports/:id    # Delete report
```

### Checkpoints
```bash
GET  /api/checkpoints      # List checkpoints
POST /api/checkpoints      # Create checkpoint
POST /api/checkpoints/:id/apply  # Restore checkpoint
DELETE /api/checkpoints/:id      # Delete checkpoint
```

## 📁 Project Structure

```
market-research-agent/
├── server.ts              # Main server and API logic
├── deno.json             # Deno configuration
├── .env                  # Environment variables (not in git)
├── prompts/
│   └── ideaCompetitorPrompt.ts  # AI prompt templates
├── public/
│   ├── index.html        # Main UI
│   ├── report.html       # Report detail page
│   ├── reports.html      # Reports list page
│   ├── visualize.html    # Visualization page
│   └── styles.css        # Styling
├── storage/
│   └── gcsStorage.ts     # Google Cloud Storage service
├── types/
│   ├── approval.ts       # Tool approval types
│   └── reports.ts        # Report types
└── utils/
    └── toolApprovalHelper.ts  # Approval helpers
```

## 🔧 Configuration

### Analysis Modes

| Mode | Tool Calls | Iterations | Timeout | Use Case |
|------|-----------|-----------|---------|----------|
| **Quick** | 5 | 20 | 2 min | Fast feedback, limited research |
| **Deep** | 999 | 50 | 5 min | Comprehensive analysis, full research |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Yes | - | DeepSeek AI API key |
| `FIRECRAWL_API_KEY` | No | - | Firecrawl web scraping key |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | - | GCS service account key path |
| `GCS_BUCKET_NAME` | No | - | GCS bucket for file storage |
| `MAX_TOOL_CALLS` | No | 5 | Max tool calls in quick mode |
| `MAX_ITERATIONS` | No | 20 | Max AI iterations |
| `ANALYSIS_TIMEOUT_MS` | No | 120000 | Analysis timeout (ms) |

## 🐛 Troubleshooting

### "Server is busy" error
- Only one analysis can run at a time
- Wait for current analysis to complete or refresh page

### Tool approval not working
- Check console logs for approval requests
- Ensure `requireToolApproval` is set to `true`

### Firecrawl errors
- Verify `FIRECRAWL_API_KEY` is set correctly
- Check API quota and rate limits

### File upload fails
- Ensure file is < 10MB
- Supported formats: PDF, DOCX, TXT, MD
- If using GCS, verify credentials and bucket permissions

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- [Zypher](https://github.com/corespeed/zypher) - AI agent framework
- [DeepSeek](https://www.deepseek.com/) - AI model provider
- [Firecrawl](https://firecrawl.dev/) - Web scraping service
- [Deno](https://deno.land/) - JavaScript runtime

## 📧 Contact

For questions or support, please open an issue on GitHub.

---

Built with ❤️ by [jianan-kristine](https://github.com/jianan-kristine)
