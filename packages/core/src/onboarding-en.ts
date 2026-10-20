import type { OnboardingContent } from "./onboarding.js";

/** 英文界面的引导内容。id、数据源和写入模块与中文版一致，只换文字。 */
export const ONBOARDING_EN = {
  welcome: {
    title:
      "Let AI keep up with you, and turn what you want to change into progress you can push and look back on",
    first: "Name one thing you want to change",
  },
  matter: {
    entry: "Name one thing you want to change",
    question: "What have you wanted to change but haven't moved on yet?",
    examples: [
      {
        title: "I can't stick with eating well and training",
        text: "I want to eat healthier and work out three times a week, but I always drop off within two weeks.",
      },
      {
        title: "I'm tired of my job but don't know what else to do",
        text: "I've been in my current job for four years and it feels flat, but I don't know what else I could do.",
      },
      {
        title: "Finish my portfolio in six weeks",
        text: `Me: I want to finish my portfolio in six weeks and move into product design.
ChatGPT: Start with 2–3 projects that best show how you solve problems. For each, write the context, your decisions and the results.
ChatGPT: Set two fixed evenings a week. In week one, pick the projects and list what material is missing.
Me: I have 4 projects, but the store scheduling one still lacks post-launch data.
ChatGPT: Then start with the other two and add the scheduling project once you have the data.`,
      },
    ],
  },
  steps: ["Bring one thing", "Pick focus areas", "Connect health, calendar and more", "Choose an AI"],
  ais: [
    {
      id: "chatgpt",
      name: "ChatGPT",
      hint: "Also copy the list under Settings → Personalization → Memory → Manage; ChatGPT sometimes leaves a few out.",
    },
    { id: "claude", name: "Claude", hint: "If memory is on, also copy what's in Claude's memory settings." },
    { id: "gemini", name: "Gemini", hint: "Also copy what's on the Saved info page." },
    {
      id: "other",
      name: "Other",
      hint: "Paste the answer from your usual AI; unrecognized lines keep their original text.",
    },
  ],
  prompt: `Please list everything you remember about me, as close to the original wording as possible. Don't summarize or leave things out. Include:
1. Your saved memories
2. My custom instructions or personalization preferences
3. What you've learned about me from our conversations: work, goals, health, routines, interests, projects I'm working on, important people
4. Things I'm still deciding or weighing (for example whether to change jobs or move cities)
Output one item per line in this format, choosing the category from Work, Goal, Project, Considering, Health, Preference, Person, Fact, Interest, Place:
[Category] content (add the date at the end if you know when you noted it)`,
  categories: {},
  starts: [
    {
      id: "me",
      title: "Understand where I am",
      summary: "Bring the scattered pieces together, then watch how things change over time",
      sources: ["mail"],
      module: "me",
      next: "Bring over memories and fill in where you are now",
    },
    {
      id: "projects",
      title: "Move my projects forward",
      summary: "Note what you're working on; AI keeps an eye on milestones and next steps",
      sources: ["projects"],
      module: "projects",
      next: "Connect a project and write its next step",
    },
    {
      id: "health",
      title: "Eat, sleep and train well",
      summary: "See sleep, training, meals and checkups together",
      sources: ["health"],
      module: "health",
      next: "Import health data, or log a meal or a workout",
    },
    {
      id: "finance",
      title: "Get on top of money",
      summary: "Bills, holdings and assets: see where the money goes",
      sources: ["finance", "mail"],
      module: "finance",
      next: "Import a bill or your holdings",
    },
    {
      id: "calendar",
      title: "Get my schedule in order",
      summary: "Connect a calendar; AI plans your day each morning",
      sources: ["calendar"],
      module: "calendar",
      next: "Import a calendar and plan today",
    },
    {
      id: "explore",
      title: "Think through a direction",
      summary: "Like whether to move cities or change jobs: write the question first, then try things",
      sources: [],
      module: "explore",
      next: "Write down a question you want to explore",
    },
    {
      id: "news",
      title: "Read useful news every day",
      summary: "Only what relates to what you're doing",
      sources: ["news"],
      module: "feed",
      next: "Write down the topics you follow",
    },
  ],
  sources: [
    {
      id: "calendar",
      title: "Calendar",
      description:
        "Subscribe to an ICS address from Google Calendar, iCloud or Outlook to keep your schedule updated.",
      action: "Add a calendar subscription",
      target: "calendar",
      available: true,
    },
    {
      id: "health",
      title: "Apple Health",
      description:
        "On iPhone: Health → your profile picture → Export All Health Data, then import the archive.",
      action: "Choose the export file",
      target: "import:apple-health",
      available: true,
    },
    {
      id: "finance",
      title: "Bills and holdings",
      description:
        "Import bill or holdings CSV files in a supported format. You see a preview before anything is saved.",
      action: "Choose a bill file",
      target: "finance",
      available: true,
    },
    {
      id: "projects",
      title: "Projects",
      description: "Connect a local folder or a GitHub repository, then confirm to create the project.",
      action: "Choose a project",
      target: "setup:projects",
      available: true,
    },
    {
      id: "mail",
      title: "Email and chats",
      description: "Connect an email or chat account under AI & connections to receive excerpts and links.",
      action: "Set up email and chats",
      target: "connections",
      available: true,
    },
    {
      id: "news",
      title: "Topics you follow",
      description:
        'Write a few topics you care about, such as "indie development" or "living in Southeast Asia".',
      action: "Write topics",
      target: "setup:news",
      available: true,
    },
  ],
  aiChoices: [
    {
      id: "builtin",
      title: "Use Ask inside Kaitu",
      description:
        "Paste an API key from an AI service (DeepSeek, OpenAI, Claude, Gemini, Kimi, Zhipu and others)",
      target: "ask",
    },
    {
      id: "mine",
      title: "Keep going in the AI you already use",
      description: "Copy the context pack into your usual AI, then paste its answer back to continue.",
      target: "connections",
    },
    {
      id: "none",
      title: "No AI for now",
      description: "Quick notes and imports work; organize later once you connect one",
      target: "today",
    },
  ],
  checklist: {
    storage: "Choose where your notes live",
    matter: "Bring one thing and adopt a first next step",
    memory: "Let Kaitu get to know you (optional)",
    starts: "Pick what to focus on first",
    sources: "Connect health, calendar and more",
    ai: "Choose an AI to help you organize",
    plan: "Get your first plan for today",
    sourcePrefix: "Connect ",
    action: "Start",
  },
} satisfies OnboardingContent;
