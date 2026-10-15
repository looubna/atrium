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
  // The Story Course in the Park, in order (STORY_COURSE).
  | 'story-spine'
  | 'story-orientation'
  | 'story-curiosity'
  | 'story-tension'
  | 'story-vivid'
  | 'story-meaning'
  | 'story-delivery'
  | 'story-retell'
  | 'story-signature'

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
  /** A weak and a strong version of the technique, shown before the first round (Story Course). */
  example?: { weak: string; strong: string }
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
  // The Story Course (Park → Storytelling). Each step trains one technique with research behind it;
  // the source is named in `why`. Rules, measurements and challenges: backend practice/catalog.py.
  'story-spine': {
    id: 'story-spine',
    title: 'The Spine: And, But, Therefore',
    goal: 'Tell a whole story in about 30 seconds on And, But, Therefore.',
    prepSeconds: 20,
    speakSeconds: 45,
    tips: [
      'Start with the situation: “I had just moved to Seoul, and…”',
      'Turn it with BUT: the problem or the surprise',
      'Finish with THEREFORE: what happened because of it',
    ],
    why: 'Strong stories turn on “but” and “therefore”; weak ones pile up “and… and… and”, and feel like a list. We count your buts per and — the Narrative Index from Randy Olson’s And-But-Therefore framework.',
    example: {
      weak: 'I moved to Seoul and I started a new job and I met my team and we worked on a project and it went well.',
      strong: 'I moved to Seoul for my dream job, but on day one my manager quit — so I had to lead a team I’d met that morning.',
    },
  },
  'story-orientation': {
    id: 'story-orientation',
    title: 'Set the Scene',
    goal: 'In the first 15 seconds: who, where, when — and what someone wants.',
    prepSeconds: 30,
    speakSeconds: 75,
    tips: [
      'Name the person and the place: “My grandmother, in her tiny kitchen in Fez…”',
      'Say when: “the night before my final exam…”',
      'Say what they wanted — that’s what the listener will root for',
    ],
    why: 'Studying hundreds of recorded personal stories, the linguist William Labov found they open with an “orientation” — who, where, when — before the action. Listeners need someone to care about first. Large text studies find strong stories front-load these scene-setting words (Boyd, Blackburn & Pennebaker, 2020).',
    example: {
      weak: 'So this thing happened once, it was kind of crazy.',
      strong: 'It was 6 a.m. in a hospital corridor in Lyon, and my brother — who had never been ill a day in his life — was asking for a priest.',
    },
  },
  'story-curiosity': {
    id: 'story-curiosity',
    title: 'The Curiosity Gap',
    goal: 'Open a question in the first 10 seconds — and don’t answer it until late.',
    prepSeconds: 30,
    speakSeconds: 90,
    tips: [
      'Start with a line that raises a question: “The email that got me fired was three words long.”',
      'Hold the answer back; give small clues on the way',
      'Reveal it near the end, not in the middle',
    ],
    why: 'Curiosity is a gap between what we know and what we want to know (Loewenstein, 1994). Brain scans show curiosity activates the brain’s reward system and improves memory for the answer (Kang et al., 2009) — this is the “dopamine” of a good story.',
    example: {
      weak: 'I want to tell you about the time I lost my job. It was because of an email I sent. Let me explain.',
      strong: 'The email that got me fired was three words long. … [the build-up] … Three words: “Reply all: agreed.”',
    },
  },
  'story-tension': {
    id: 'story-tension',
    title: 'Rising Tension',
    goal: 'Put an obstacle in the way and make it worse, step by step, up to a climax.',
    prepSeconds: 30,
    speakSeconds: 90,
    tips: [
      'Give the main character a clear goal and a clear obstacle',
      'Escalate: each new moment raises the stakes',
      'Put the hardest moment just before the end',
    ],
    why: 'Stories that follow the classic dramatic arc hold attention as tension rises, and the empathy people feel peaks at the resolution (Paul Zak’s research on the dramatic arc). Across thousands of narratives, words of doubt and reasoning peak near the climax (Boyd et al., 2020).',
    example: {
      weak: 'Then we missed the bus. Then it rained. Then we got there.',
      strong: 'We missed the last bus — fine, we’d walk. Then the rain started. Then my phone died, with the only copy of the address on it.',
    },
  },
  'story-vivid': {
    id: 'story-vivid',
    title: 'Make It Vivid',
    goal: 'Make the listener see it: names, numbers, senses and one line of dialogue.',
    prepSeconds: 30,
    speakSeconds: 90,
    tips: [
      'Swap general words for specific ones: not “a car” but “a rusty red Fiat”',
      'Add one sense: a sound, a smell, the temperature',
      'Quote someone: “He looked at me and said, ‘You’re late.’”',
    ],
    why: 'People are most moved and persuaded by stories that “transport” them — vivid images, feeling and full attention together (Green & Brock, 2000, confirmed by later meta-analyses). Concrete words are also remembered better than abstract ones.',
    example: {
      weak: 'My boss was upset about the report.',
      strong: 'My boss dropped the report on my desk — 42 pages, a coffee ring on the cover — and said, “Did you read this before you sent it?”',
    },
  },
  'story-meaning': {
    id: 'story-meaning',
    title: 'Resolution and Meaning',
    goal: 'Say how it ended, what it meant — and close by returning to the opening.',
    prepSeconds: 30,
    speakSeconds: 90,
    tips: [
      'Answer the question you opened',
      'Say what changed in one sentence: “That’s when I learned…”',
      'End by calling back to your first image or line',
    ],
    why: 'Labov found the stories people tell well include an “evaluation” — the teller saying why it mattered — and a coda that brings the listener back to now. A callback closes the loop and makes the point stick.',
    example: {
      weak: '…and yeah, so that’s what happened. Anyway.',
      strong: '…I never got that job. But I got my brother back. Three words in an email cost me a career; three words in a hospital corridor gave me a family.',
    },
  },
  'story-delivery': {
    id: 'story-delivery',
    title: 'Deliver the Reveal',
    goal: 'Tell a story with a clear pause just before the reveal, at an easy pace, without fillers.',
    prepSeconds: 30,
    speakSeconds: 90,
    tips: [
      'Pause for a full second right before the big moment',
      'Slow down for the key sentence; speed up in the action',
      'Replace “um” with silence',
    ],
    why: 'When communication works, the listener’s brain activity follows the speaker’s — and the closer they are in sync, the better the listener understands (Stephens, Silbert & Hasson, 2010). A clear pace and a well-placed pause give them time to anticipate.',
    example: {
      weak: '…and then um basically it turned out it was empty so yeah.',
      strong: '…he lifted the lid. [one-second pause] It was empty.',
    },
  },
  'story-retell': {
    id: 'story-retell',
    title: 'Tell It Again',
    goal: 'Tell your last story again, using its feedback — and make it better.',
    prepSeconds: 30,
    speakSeconds: 90,
    tips: [
      'Reread your last “next try” before you start',
      'Keep what worked; change one or two things',
      'Aim for a stronger hook, rising tension and a clearer meaning',
    ],
    why: 'Deliberate practice — repeating one skill with specific feedback — is how experts improve (Ericsson). Telling the same story again shows exactly how much better it became.',
  },
  'story-signature': {
    id: 'story-signature',
    title: 'Your Signature Story',
    goal: 'Tell a 2–3 minute personal story using everything you’ve learned.',
    prepSeconds: 60,
    speakSeconds: 180,
    tips: [
      'Hook in the first 10 seconds, then set the scene',
      'Rising tension, vivid detail and one line of dialogue',
      'Pause before the reveal; end with what it meant',
    ],
    why: 'A signature story is one you will tell again and again — in interviews, pitches, toasts. Everything in this course comes together here.',
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

/** What a Story Course round is about: a moment most people have lived, so everyone has a story. */
const STORY_SEEDS = [
  'A time you were completely wrong about someone',
  'The day everything changed',
  'A stranger who taught you something',
  'Your worst first day',
  'A risk that paid off',
  'A risk that didn’t',
  'The best advice you ignored',
  'A time you got lost',
  'A mistake you’re glad you made',
  'Something you lost — and found again',
  'The moment you knew you had to leave',
  'A teacher you’ll never forget',
  'A time you had to be brave',
  'An unexpected phone call',
  'A meal you’ll never forget',
  'The hardest decision you made this year',
  'A time you surprised yourself',
  'A promise you kept — or broke',
  'Your first time abroad',
  'A time a plan fell apart',
  'Someone who changed your mind',
  'A secret you kept for too long',
  'The day you almost gave up',
  'A small moment that meant a lot',
  'A time you helped a stranger',
]

/** The capstone: the stories worth telling for years. */
const SIGNATURE_SEEDS = [
  'A moment that shaped who you are',
  'Why you do the work you do',
  'A failure that taught you something',
  'The person who changed your life',
  'The day you became an adult',
]

/** The Story Course, in the order its steps unlock. */
export const STORY_COURSE: DrillId[] = [
  'story-spine',
  'story-orientation',
  'story-curiosity',
  'story-tension',
  'story-vivid',
  'story-meaning',
  'story-delivery',
  'story-retell',
  'story-signature',
]

export const isStoryDrill = (id: string): boolean => id.startsWith('story-')

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
  /** The Story Course: what to tell a story about; `retell` tells the user's last story again. */
  | { kind: 'story'; seed: string; retell?: boolean }

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
    case 'story-signature':
      return { kind: 'story', seed: pick(SIGNATURE_SEEDS, previousSeed(previous)) }
    case 'story-retell':
      // DrillStage swaps in the user's last story once progress has loaded.
      return { kind: 'story', seed: pick(STORY_SEEDS, previousSeed(previous)), retell: true }
    case 'story-spine':
    case 'story-orientation':
    case 'story-curiosity':
    case 'story-tension':
    case 'story-vivid':
    case 'story-meaning':
    case 'story-delivery':
      return { kind: 'story', seed: pick(STORY_SEEDS, previousSeed(previous)) }
  }
}

function previousSeed(previous?: DrillPrompt): string | undefined {
  return previous?.kind === 'story' ? previous.seed : undefined
}

function previousQuestion(previous?: DrillPrompt): string | undefined {
  return previous && 'question' in previous ? previous.question : undefined
}

export const isDrillId = (id: string): id is DrillId => id in DRILLS
