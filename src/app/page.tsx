import Section from "./components/Section";
import Markdown from 'react-markdown';


export default function Home() {

  const markdown = `

---
## 👋 Introduction

Suno.ai v3 is an amazing AI music service. Although the official API is not yet available, we couldn't wait to integrate its capabilities somewhere.

We discovered that some users have similar needs, so we decided to open-source this project, hoping you'll like it.

We update quickly, please star us on Github:  [github.com/gcui-art/suno-api](https://github.com/gcui-art/suno-api) ⭐

## 🌟 Features

- Perfectly implements the creation API from \`app.suno.ai\`
- Compatible with the format of OpenAI’s \`/v1/chat/completions\` API.
- Automatically keep the account active.
- Supports \`Custom Mode\`
- One-click deployment to Vercel
- In addition to the standard API, it also adapts to the API Schema of Agent platforms like GPTs and Coze, so you can use it as a tool/plugin/Action for LLMs and integrate it into any AI Agent.
- Permissive open-source license, allowing you to freely integrate and modify.

## 🚀 Getting Started

### 1. Obtain the cookie of your app.suno.ai account

1. Head over to [app.suno.ai](https://app.suno.ai) using your browser.
2. Open up the browser console: hit \`F12\` or access the \`Developer Tools\`.
3. Navigate to the \`Network tab\`.
4. Give the page a quick refresh.
5. Identify the request that includes the keyword \`client?_clerk_js_version\`.
6. Click on it and switch over to the \`Header\` tab.
7. Locate the \`Cookie\` section, hover your mouse over it, and copy the value of the Cookie.
`;


  const markdown_part2 = `
### 2. Clone and deploy this project

You can choose your preferred deployment method:

#### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgcui-art%2Fsuno-api&env=SUNO_COOKIE&project-name=suno-api&repository-name=suno-api)

#### Run locally

\`\`\`bash
git clone https://github.com/gcui-art/suno-api.git
cd suno-api
npm install
\`\`\`

### 3. Configure suno-api

- If deployed to Vercel, please add an environment variable \`SUNO_COOKIE\` in the Vercel dashboard, with the value of the cookie obtained in the first step.

- If you’re running this locally, be sure to add the following to your \`.env\` file:

  \`\`\`bash
  SUNO_COOKIE=<your-cookie>
  \`\`\`

### 4. Run suno-api

- If you’ve deployed to Vercel:
  - Please click on Deploy in the Vercel dashboard and wait for the deployment to be successful.
  - Visit the \`https://<vercel-assigned-domain>/api/get_limit\` API for testing.
- If running locally:
  - Run \`npm run dev\`.
  - Visit the \`http://localhost:3000/api/get_limit\` API for testing.
- If the following result is returned:

  \`\`\`json
  {
    "credits_left": 50,
    "period": "day",
    "monthly_limit": 50,
    "monthly_usage": 50
  }
  \`\`\`

it means the program is running normally.

### 5. Use Suno API

You can check out the detailed API documentation at [suno.gcui.ai/docs](https://suno.gcui.ai/docs).

## 📚 API Reference

Suno API currently mainly implements the following APIs:

\`\`\`bash
- \`/api/generate\`: Generate music
- \`/v1/chat/completions\`: Generate music - Call the generate API in a format 
  that works with OpenAI’s API.
- \`/api/custom_generate\`: Generate music (Custom Mode, support setting lyrics, 
  music style, title, etc.)
- \`/api/generate_lyrics\`: Generate lyrics based on prompt
- \`/api/get\`: Get music list
- \`/api/get?ids=\`: Get music Info by id, separate multiple id with ",".
- \`/api/get_limit\`: Get quota Info
- \`/api/extend_audio\`: Extend audio length
- \`/api/generate_stems\`: Make stem tracks (separate audio and music track)
- \`/api/get_aligned_lyrics\`: Get list of timestamps for each word in the lyrics
- \`/api/concat\`: Generate the whole song from extensions
\`\`\`

For more detailed documentation, please check out the demo site:

👉 [suno.gcui.ai/docs](https://suno.gcui.ai/docs)

`;
  return (
    <>
      <Section className="">
        <div className="flex flex-col m-auto py-20 text-center items-center justify-center gap-4 my-8
        lg:px-20 px-4
        bg-indigo-900/90 rounded-2xl border shadow-2xl hover:shadow-none duration-200">
          <span className=" px-5 py-1 text-xs font-light border rounded-full 
          border-white/20 uppercase text-white/50">
            Unofficial
          </span>
          <h1 className="font-bold text-7xl flex text-white/90">
            Suno AI API
          </h1>
          <p className="text-white/80 text-lg">
            `Suno-api` is an open-source project that enables you to set up your own Suno AI API.
          </p>
          <a href="https://github.com/prismosoft/suno-api" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-2 mt-2 text-sm font-medium text-white border border-white/20 rounded-full hover:bg-white/10 transition-colors">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
            prismosoft/suno-api
          </a>
        </div>

      </Section>
      <Section className="my-10">
        <article className="prose lg:prose-lg max-w-3xl">
          <Markdown>
            {markdown}
          </Markdown>
          <video controls width="1024" className="w-full border rounded-lg shadow-xl">
            <source src="/get-cookie-demo.mp4" type="video/mp4" />
            Your browser does not support frames.
          </video>
          <Markdown>
            {markdown_part2}
          </Markdown>
        </article>
      </Section>


    </>
  );
}
