/**
 * The Practice Center's short speaking drills: what each asks of the user, its
 * timings, and the pools of prompts a round draws from.
 */

export type DrillId =
  | 'random-word-story'
  | 'think-on-your-feet'
  | 'framework-challenge'
  | 'explain-it-simply'
  | 'take-both-sides'
  | 'describe-the-image'
  | 'recall-and-retell'
  | 'pause-dont-fill'
  | 'emphasis-and-melody'
  | 'clear-diction'
  | 'pace-control'
  | 'speak-to-the-lens'
  | 'project-to-the-end'

export interface Drill {
  id: DrillId
  title: string
  /** One line: what the round asks for. */
  goal: string
  /** Seconds to read a passage before it is hidden (Recall & Retell only). */
  readSeconds?: number
  prepSeconds: number
  speakSeconds: number
  /** What a good answer does; shown before the first round and to check against after each. */
  tips: string[]
  /** Where the technique comes from, shown before the first round. */
  why?: string
  /** The drill uses the camera (on-device face tracking only). */
  camera?: boolean
}

export const DRILLS: Record<DrillId, Drill> = {
  'random-word-story': {
    id: 'random-word-story',
    title: 'Random Word Story',
    goal: 'Tell a short story that uses all three words.',
    prepSeconds: 20,
    speakSeconds: 90,
    tips: ['Give the story a beginning, a turn and an ending', 'Use every word — tap each one as you say it', 'Keep going: no word is too strange to fit'],
  },
  'think-on-your-feet': {
    id: 'think-on-your-feet',
    title: 'Think on Your Feet',
    goal: 'Answer a question you haven’t seen, with almost no time to prepare.',
    prepSeconds: 10,
    speakSeconds: 60,
    tips: ['Lead with your answer in one sentence', 'Back it with one reason and one example', 'Finish by coming back to your answer'],
  },
  'framework-challenge': {
    id: 'framework-challenge',
    title: 'Framework Challenge',
    goal: 'Answer the question by following the framework, step by step.',
    prepSeconds: 30,
    speakSeconds: 90,
    tips: ['Say each step out loud as a signpost', 'Spend roughly equal time on each step', 'Keep each step to one clear idea'],
  },
  'explain-it-simply': {
    id: 'explain-it-simply',
    title: 'Explain it Simply',
    goal: 'Explain the idea so the listener truly gets it.',
    prepSeconds: 20,
    speakSeconds: 75,
    tips: ['No jargon — or explain it the moment you use it', 'Use one everyday comparison', 'End with why it matters to them'],
  },
  'take-both-sides': {
    id: 'take-both-sides',
    title: 'Take Both Sides',
    goal: 'Argue for the statement, then switch and argue against it, just as convincingly.',
    prepSeconds: 30,
    speakSeconds: 120,
    tips: ['Give each side its strongest argument, not a weak one', 'Switch sides cleanly when the timer tells you', 'Use a fact or an example on each side'],
  },
  'describe-the-image': {
    id: 'describe-the-image',
    title: 'Describe the Image',
    goal: 'Describe the scene so someone who can’t see it could picture it.',
    prepSeconds: 15,
    speakSeconds: 75,
    tips: ['Start with the big picture, then move to details', 'Guide the listener: left, right, in front, behind', 'Say what people are doing and how it feels'],
  },
  'recall-and-retell': {
    id: 'recall-and-retell',
    title: 'Recall & Retell',
    goal: 'Read the passage, then retell it in your own words once it is hidden.',
    readSeconds: 40,
    prepSeconds: 10,
    speakSeconds: 60,
    tips: ['Cover who, what, where, when and why', 'Keep the events in order', 'Use your own words, not the original sentences'],
  },
  'pause-dont-fill': {
    id: 'pause-dont-fill',
    title: 'Pause, Don’t Fill',
    goal: 'Answer an interview question without a single filler word — pause silently instead.',
    prepSeconds: 15,
    speakSeconds: 60,
    tips: [
      'When you need a moment, close your mouth and pause',
      'Breathe at the end of each sentence',
      'Tap the counter each time an “um”, “uh”, “like” or “you know” slips out',
    ],
    why: 'Awareness plus a deliberate pause is how speech coaches remove fillers; Toastmasters clubs count them live with an “Ah-Counter”.',
  },
  'emphasis-and-melody': {
    id: 'emphasis-and-melody',
    title: 'Emphasis & Melody',
    goal: 'Read the answer aloud so the highlighted words stand out, then say it again in your own words.',
    prepSeconds: 20,
    speakSeconds: 45,
    tips: [
      'Say highlighted words a little slower and louder',
      'Pause for a beat right after a key word',
      'Let your pitch rise and fall — never read on one note',
    ],
    why: 'Marking key words, then stressing and pausing on them, is the script-marking technique voice coaches use to fix a flat, monotone delivery.',
  },
  'clear-diction': {
    id: 'clear-diction',
    title: 'Clear Diction',
    goal: 'Warm up with the tongue twister, then read the passage twice: over-articulated, then natural but just as clear.',
    prepSeconds: 15,
    speakSeconds: 75,
    tips: [
      'Exaggerate every consonant on the first read',
      'Finish the ends of words: -t, -d, -ng',
      'Slow down rather than slur',
    ],
    why: 'Over-articulating and then relaxing builds the muscle memory for crisp speech — a staple of diction training for presenters and actors.',
  },
  'pace-control': {
    id: 'pace-control',
    title: 'Pace Control',
    goal: 'Read the answer aloud and finish inside the target time — a comfortable 130–160 words a minute.',
    prepSeconds: 15,
    speakSeconds: 90,
    tips: [
      'Pause at every full stop',
      'Land each sentence before starting the next',
      'Finished early? You rushed. Late? Tighten your pauses',
    ],
    why: 'Reading to a target time calibrates your sense of a comfortable interview pace, which you then carry into free answers.',
  },
  'speak-to-the-lens': {
    id: 'speak-to-the-lens',
    title: 'Speak to the Lens',
    goal: 'Answer while looking into the camera lens, with a warm, open expression.',
    prepSeconds: 15,
    speakSeconds: 60,
    tips: [
      'Put the camera at eye level',
      'Look into the lens — not at the screen — for key points',
      'Start and finish your answer with a natural smile',
    ],
    why: 'Recruiters recommend recording practice answers to camera: on video, looking into the lens is what reads as eye contact.',
    camera: true,
  },
  'project-to-the-end': {
    id: 'project-to-the-end',
    title: 'Project to the End',
    goal: 'Answer out loud, keeping your voice strong right through the last word of every sentence.',
    prepSeconds: 15,
    speakSeconds: 60,
    tips: [
      'Take a low belly breath before each sentence',
      'Aim your voice at someone across the room',
      'Hit the last word as firmly as the first',
    ],
    why: 'Voice coaches fix trailing off with diaphragmatic breathing and full-energy sentence endings.',
  },
}

export interface Framework {
  name: string
  steps: string[]
  questions: string[]
}

export const FRAMEWORKS: Framework[] = [
  {
    name: 'STAR',
    steps: ['Situation', 'Task', 'Action', 'Result'],
    questions: [
      'Tell me about a time you solved a problem under pressure.',
      'Describe a time you had to work with someone difficult.',
      'Tell me about a mistake you made and what you did next.',
      'Describe a time you led something without being in charge.',
    ],
  },
  {
    name: 'PREP',
    steps: ['Point', 'Reason', 'Example', 'Point again'],
    questions: [
      'Should everyone learn a second language?',
      'Is it better to work in a big company or a small one?',
      'Should meetings have a strict time limit?',
      'Is it worth reading the news every day?',
    ],
  },
  {
    name: 'Problem · Solution · Benefit',
    steps: ['Problem', 'Solution', 'Benefit'],
    questions: [
      'Pitch an idea to make your commute better.',
      'Propose a change that would improve your team’s week.',
      'Suggest a way to cut food waste at home.',
      'Propose one change to make your city friendlier.',
    ],
  },
  {
    name: 'What · So what · Now what',
    steps: ['What happened', 'So what — why it matters', 'Now what — what next'],
    questions: [
      'Reflect on the last project you finished.',
      'Talk about a trend you have noticed at work or school.',
      'Reflect on a piece of feedback you received.',
    ],
  },
  {
    name: 'Present · Past · Future',
    steps: ['Present — what you do now', 'Past — how you got here', 'Future — why this role is next'],
    questions: [
      'Tell me about yourself.',
      'Walk me through your background.',
      'Why are you interested in this role?',
      'Introduce yourself in one minute.',
    ],
  },
  {
    name: 'Acknowledge · Bridge · Communicate',
    steps: ['Acknowledge the question honestly', 'Bridge — “What I’ve learned is…”', 'Communicate your key strength'],
    questions: [
      'What is your biggest weakness?',
      'Why is there a gap in your CV?',
      'Tell me about a time you failed.',
      'Why should we hire you over someone with more experience?',
      'Why are you leaving your current job?',
    ],
  },
  {
    name: 'Past · Present · Future',
    steps: ['Past', 'Present', 'Future'],
    questions: [
      'How has the way people shop changed?',
      'Talk about how you learn new skills.',
      'How has your job or field of study evolved?',
    ],
  },
]

const WORDS = [
  'umbrella', 'volcano', 'passport', 'violin', 'lighthouse', 'pancake', 'satellite', 'garden', 'mirror', 'penguin',
  'elevator', 'map', 'thunder', 'bicycle', 'library', 'candle', 'secret', 'rocket', 'bakery', 'compass',
  'island', 'ticket', 'dragon', 'telescope', 'orchestra', 'backpack', 'glacier', 'robot', 'lantern', 'suitcase',
  'museum', 'tornado', 'piano', 'balloon', 'key', 'desert', 'camera', 'coffee', 'river', 'crown',
  'train', 'wallet', 'festival', 'ladder', 'storm', 'letter', 'mountain', 'clock', 'market', 'kite',
  'hospital', 'octopus', 'bridge', 'diary', 'magnet', 'forest', 'helmet', 'moonlight', 'recipe', 'puzzle',
  'airport', 'feather', 'tractor', 'wedding', 'scarf', 'treasure', 'podcast', 'cactus', 'marathon', 'blanket',
  'spaceship', 'lemon', 'stadium', 'whistle', 'fog', 'painting', 'submarine', 'hammer', 'parrot', 'invitation',
]

const QUESTIONS = [
  'What is the most useful thing you have learned outside school?',
  'If you could master one skill overnight, which would it be and why?',
  'What makes a good leader?',
  'Describe your perfect weekend.',
  'What would you change about how people work today?',
  'What is a small habit that made a big difference for you?',
  'Is it better to plan everything or to stay flexible?',
  'What advice would you give your younger self?',
  'Which invention could you not live without?',
  'What makes a city a great place to live?',
  'How do you handle a day when nothing goes right?',
  'What is something most people misunderstand about your field?',
  'Should everyone travel alone at least once?',
  'What makes a conversation memorable?',
  'Which book, film or series changed how you think?',
  'What would you do with an extra hour every day?',
  'How do you decide who to trust?',
  'What does success mean to you?',
  'What is the best way to learn from failure?',
  'If you started a company tomorrow, what would it do?',
  'What is a rule you think should be broken?',
  'How will your job look in ten years?',
  'What is the hardest decision you have had to make recently?',
  'What would you teach a class of strangers in five minutes?',
]

const CONCEPTS: { concept: string; audience: string }[] = [
  { concept: 'How the internet sends a message across the world', audience: 'a ten-year-old' },
  { concept: 'Inflation', audience: 'a teenager with a first job' },
  { concept: 'Why the sky is blue', audience: 'a curious child' },
  { concept: 'What a mortgage is', audience: 'a friend who just started renting' },
  { concept: 'How vaccines work', audience: 'your grandparent' },
  { concept: 'Compound interest', audience: 'a sixteen-year-old saving money' },
  { concept: 'What artificial intelligence is', audience: 'someone who has never used a computer' },
  { concept: 'Supply and demand', audience: 'a child running a lemonade stand' },
  { concept: 'How a plane stays in the air', audience: 'a nervous first-time flyer' },
  { concept: 'What a cloud service is', audience: 'a small shop owner' },
  { concept: 'Climate versus weather', audience: 'a ten-year-old' },
  { concept: 'How your heart pumps blood', audience: 'a primary school class' },
  { concept: 'What a budget is and why it helps', audience: 'a university student' },
  { concept: 'How GPS knows where you are', audience: 'a curious child' },
  { concept: 'What a password manager does', audience: 'your grandparent' },
  { concept: 'Why exercise improves your mood', audience: 'a busy colleague' },
  { concept: 'What a blockchain is', audience: 'a friend who is sceptical of tech' },
  { concept: 'How recycling actually works', audience: 'a ten-year-old' },
  { concept: 'What your job involves', audience: 'someone meeting you at a party' },
  { concept: 'How sleep helps memory', audience: 'a student before exams' },
  { concept: 'What an election poll measures', audience: 'a first-time voter' },
  { concept: 'Why prices differ between countries', audience: 'a traveller on their first trip abroad' },
]

const MOTIONS = [
  'Remote work is better than working in an office.',
  'Cities should close their centres to cars.',
  'Social media does more good than harm.',
  'Everyone should learn to code.',
  'A four-day work week should be the standard.',
  'Exams are a fair way to measure ability.',
  'Books are better than their film adaptations.',
  'Space exploration is worth what it costs.',
  'It is better to be a generalist than a specialist.',
  'Failure teaches more than success.',
  'Cash should be phased out.',
  'Tourism does more good than harm to popular cities.',
  'Artificial intelligence will create more jobs than it replaces.',
  'University education should be free.',
  'School uniforms should be required.',
  'Homework should be optional.',
  'Working for yourself is better than working for a company.',
  'Tipping should be replaced by higher wages.',
  'Children should learn money management at school.',
  'Public transport should be free.',
]

const IMAGES: { src: string; alt: string }[] = [
  { src: '/drills/describe/market.jpg', alt: 'A busy open-air food market on a sunny morning' },
  { src: '/drills/describe/station.jpg', alt: 'A train station hall at rush hour' },
  { src: '/drills/describe/kitchen.jpg', alt: 'A family kitchen while dinner is being prepared' },
  { src: '/drills/describe/workshop.jpg', alt: 'A small bicycle repair workshop' },
  { src: '/drills/describe/beach.jpg', alt: 'A seaside promenade in the late afternoon' },
  { src: '/drills/describe/park.jpg', alt: 'A city park on an autumn weekend' },
]

const PASSAGES: { title: string; text: string }[] = [
  {
    title: 'The borrowed umbrella',
    text: 'On a rainy Tuesday in Lisbon, Marta left her umbrella at a café. The next morning a note was taped to the café door: “Blue umbrella found — ask for Rui.” Rui, the baker next door, had kept it dry for her. To thank him, Marta brought him a jar of her grandmother’s orange jam. Rui now sells toast with that jam every Friday.',
  },
  {
    title: 'The rooftop garden',
    text: 'Three years ago, the staff of a small office in Manchester turned their empty roof into a garden. They started with ten pots of tomatoes. Today the roof grows herbs, beans and strawberries, and every September the team holds a lunch made only from what they grew. The idea came from an intern who missed her family’s farm.',
  },
  {
    title: 'The late train',
    text: 'Karim’s train to his job interview in Lyon was delayed by forty minutes. Instead of panicking, he called the company from the platform, explained the delay and asked if they could move the interview to a video call. They agreed. He did the interview from a quiet corner of the station café — and started the job two weeks later.',
  },
  {
    title: 'The library bike',
    text: 'A town library in the Netherlands bought a cargo bike and filled it with books. Every Saturday a volunteer named Anneke rides it to the market square. People borrow books without a card; they just write their name in a notebook. In the first year, fewer than ten books went missing, and more than two thousand were borrowed.',
  },
  {
    title: 'The wrong address',
    text: 'A birthday cake meant for a seven-year-old named Leo was delivered to the wrong house. The family there, whose son was also called Leo, realised the mistake when they saw a dinosaur on top — their Leo was turning forty. They drove the cake across town themselves and stayed for a slice. The two families now meet every summer.',
  },
  {
    title: 'The quiet hour',
    text: 'A supermarket in Auckland introduced a “quiet hour” every Wednesday evening. The music is turned off, the lights are dimmed and announcements stop. It was first designed for shoppers who find noise stressful, but staff say many other customers now choose that hour too. Several other stores in the city have since copied the idea.',
  },
  {
    title: 'The lost ring',
    text: 'While swimming off a beach in Crete, Sofia lost her wedding ring. A local diver, Nikos, offered to search the next morning before the water got busy. After an hour he found it wedged between two rocks. He refused any payment, so Sofia and her husband sent a donation to the island’s volunteer lifeguard team in his name.',
  },
  {
    title: 'The first podcast',
    text: 'Two nurses in Toronto started recording short talks during their night-shift breaks, explaining health questions patients often asked. They posted them online without expecting much. Within a year the podcast had listeners in forty countries, and a hospital asked them to turn the episodes into waiting-room videos.',
  },
]

const INTERVIEW_QUESTIONS = [
  'Tell me about yourself.',
  'Why do you want this role?',
  'What is your greatest strength?',
  'Tell me about a challenge you overcame.',
  'Where do you see yourself in three years?',
  'What would your last manager say about you?',
  'Describe a project you are proud of.',
  'How do you handle tight deadlines?',
  'What do you know about our company?',
  'Tell me about a time you worked with a difficult colleague.',
]

/** Interview answers with [[key words]] to stress. */
const EMPHASIS_SCRIPTS = [
  'In my last role, I [[led]] the move to a new billing system. We finished [[two weeks early]], and support tickets dropped by [[thirty percent]]. What I learned is that [[clear ownership]] makes hard projects move.',
  'I’m applying because this role sits right where my [[experience]] and my [[interests]] meet. I’ve spent [[four years]] improving onboarding, and your team is solving exactly that problem — at a [[much bigger scale]].',
  'My biggest strength is [[turning messy problems into plans]]. When our launch slipped, I broke it into [[three priorities]], agreed owners by [[the next morning]], and we shipped [[on time]].',
  'A mistake I learned from: I [[assumed]] a client wanted speed over accuracy. Now I [[ask]] first — and that one question saved us a [[full week]] of rework.',
]

const TONGUE_TWISTERS = [
  'Red lorry, yellow lorry',
  'Unique New York, you know you need unique New York',
  'She sells seashells by the seashore',
  'Truly rural, truly rural',
  'Six thick thistle sticks',
]

const DICTION_PASSAGES = [
  'I tested the product, collected the results, and presented the key findings to the directors. Customers wanted clearer pricing, so we redesigned the checkout and doubled the conversion rate in six weeks.',
  'Throughout the project, I tracked deadlines, identified risks early and kept the stakeholders updated. When the budget tightened, I prioritised the three most important features and delivered them first.',
  'My background combines data analysis and product strategy. I enjoy translating complicated statistics into specific, practical decisions that the whole team can act on.',
]

const PACE_PASSAGES = [
  'I started my career in customer support, which taught me to listen before I solve. After two years I moved into operations, where I rebuilt our ticket routing and cut response times in half. Most recently I have led a small team of analysts. We turn messy data into weekly decisions for the sales leaders. What excites me about this role is the chance to do that at a larger scale, with a product that customers already love.',
  'When our biggest client threatened to leave, I asked for a meeting the same week. I listened to every complaint, grouped them into three themes, and agreed a plan with dates we could keep. Two months later they renewed for another three years, and two of their suggestions became features that every customer now uses. It reminded me that a difficult conversation is often the start of a stronger relationship.',
  'My greatest strength is staying calm when plans change. Last spring, a supplier failed a week before our launch. Instead of panicking, I listed our options, called two backup suppliers, and shared a clear update with the team by the afternoon. We launched only three days late, and the process we wrote that week is still how the company handles supply risks today.',
]

/** Seconds to read `text` at 160 (fast end) and 130 (slow end) words a minute. */
export function paceWindow(text: string): { words: number; min: number; max: number } {
  const words = text.split(/\s+/).filter(Boolean).length
  return { words, min: Math.round((words / 160) * 60), max: Math.round((words / 130) * 60) }
}

export type DrillPrompt =
  | { kind: 'words'; words: string[] }
  | { kind: 'question'; question: string }
  | { kind: 'framework'; framework: Framework; question: string }
  | { kind: 'concept'; concept: string; audience: string }
  | { kind: 'motion'; motion: string }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'passage'; title: string; text: string }
  /** Answer without fillers; the user counts slips. */
  | { kind: 'fillers'; question: string }
  /** Read an answer stressing its [[marked]] words. */
  | { kind: 'emphasis'; text: string }
  | { kind: 'diction'; twister: string; text: string }
  | { kind: 'paced'; text: string }
  | { kind: 'lens'; question: string }
  | { kind: 'projection'; question: string }

const pick = <T,>(list: T[], avoid?: T): T => {
  const pool = list.length > 1 && avoid !== undefined ? list.filter((x) => x !== avoid) : list
  return pool[Math.floor(Math.random() * pool.length)]
}

const sample = <T,>(list: T[], n: number): T[] => {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

/**
 * A fresh prompt for a round, never the same as the one before. `framework` keeps Framework
 * Challenge on one framework (e.g. STAR, when feedback sent the user here to practise it).
 */
export function makePrompt(id: DrillId, previous?: DrillPrompt, framework?: string): DrillPrompt {
  switch (id) {
    case 'random-word-story':
      return { kind: 'words', words: sample(WORDS, 3) }
    case 'think-on-your-feet':
      return { kind: 'question', question: pick(QUESTIONS, previous?.kind === 'question' ? previous.question : undefined) }
    case 'framework-challenge': {
      const chosen = FRAMEWORKS.filter((f) => f.name === framework)
      const all = (chosen.length ? chosen : FRAMEWORKS).flatMap((f) => f.questions.map((question) => ({ framework: f, question })))
      const next = pick(all.filter((p) => !(previous?.kind === 'framework' && previous.question === p.question)))
      return { kind: 'framework', ...next }
    }
    case 'explain-it-simply': {
      const next = pick(CONCEPTS.filter((c) => !(previous?.kind === 'concept' && previous.concept === c.concept)))
      return { kind: 'concept', ...next }
    }
    case 'take-both-sides':
      return { kind: 'motion', motion: pick(MOTIONS, previous?.kind === 'motion' ? previous.motion : undefined) }
    case 'describe-the-image': {
      const next = pick(IMAGES.filter((i) => !(previous?.kind === 'image' && previous.src === i.src)))
      return { kind: 'image', ...next }
    }
    case 'recall-and-retell': {
      const next = pick(PASSAGES.filter((p) => !(previous?.kind === 'passage' && previous.title === p.title)))
      return { kind: 'passage', ...next }
    }
    case 'pause-dont-fill':
      return { kind: 'fillers', question: pick(INTERVIEW_QUESTIONS, previousQuestion(previous)) }
    case 'emphasis-and-melody':
      return { kind: 'emphasis', text: pick(EMPHASIS_SCRIPTS, previous?.kind === 'emphasis' ? previous.text : undefined) }
    case 'clear-diction':
      return {
        kind: 'diction',
        twister: pick(TONGUE_TWISTERS),
        text: pick(DICTION_PASSAGES, previous?.kind === 'diction' ? previous.text : undefined),
      }
    case 'pace-control':
      return { kind: 'paced', text: pick(PACE_PASSAGES, previous?.kind === 'paced' ? previous.text : undefined) }
    case 'speak-to-the-lens':
      return { kind: 'lens', question: pick(INTERVIEW_QUESTIONS, previousQuestion(previous)) }
    case 'project-to-the-end':
      return { kind: 'projection', question: pick(INTERVIEW_QUESTIONS, previousQuestion(previous)) }
  }
}

function previousQuestion(previous?: DrillPrompt): string | undefined {
  return previous && 'question' in previous ? previous.question : undefined
}

export const isDrillId = (id: string): id is DrillId => id in DRILLS
