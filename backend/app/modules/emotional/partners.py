"""Who sits with the user on the park bench, and what each conversation is about for them.

Partners mirror `EmotionalPartner` and scenarios mirror `EMOTIONAL_SCENARIOS` in
`src/data/practice.ts`; tests keep the two in step. What is only here is what the page never
shows: the voice, the face, and the friend's side of the situation.

A partner's face is a recording on our LiveTalking server, one per orientation of the page:
`<face>_land` and `<face>_port` (`infra/livetalking/recordings/park/`), the same loop the page
shows underneath, so the lip-synced stream lands exactly on the footage. The server caches a face
once loaded, so a re-cut face gets a new name rather than replacing the old one.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Partner:
    id: str
    name: str
    voice: str
    #: Who they are to the user, in a few lines the model plays from.
    persona: str
    #: The face recording's name on the face server, without the orientation.
    face_id: str

    def face(self, landscape: bool) -> str:
        return f"{self.face_id}_{'land' if landscape else 'port'}"


PARTNERS: dict[str, Partner] = {
    p.id: p
    for p in (
        Partner(
            "woman", "Nora", "Sulafat",
            "A close friend of the user for years; you met at university and still see each other most weeks. "
            "Warm, perceptive, honest; you tease a little when things are light, and you go quiet and careful "
            "when they are not. You have your own life: a demanding job as a nurse, a younger brother you worry about.",
            "pk_woman2",
        ),
        Partner(
            "man", "Sam", "Umbriel",
            "A close friend of the user for years; you met at university and still see each other most weeks. "
            "Easy-going, loyal, a bit reserved about his own feelings; you joke to fill awkward moments. "
            "You have your own life: you work as an architect and you have just moved flats.",
            "pk_man4",
        ),
    )
}



@dataclass(frozen=True, slots=True)
class Scenario:
    """One situation the park trains, from both sides of the bench.

    The friend's side (`situation`, `arc`, `tests`, `softens_when`) is played by the model and never
    shown; the user's side (`example`, `goal`, `own_goal`, `tips`) is the brief on the page before they
    start. The user can practise the example, or their own real situation of the same kind: then the
    friend's side is the model's adaptation of it to their story (see agents/partner.py).
    """

    id: str
    label: str
    #: What happened and how the friend feels, as they know it.
    situation: str
    #: How the friend behaves as the conversation goes, from the first line to the end.
    arc: str
    #: Realistic pushbacks the friend uses, one at a time, to test the skill being trained.
    tests: tuple[str, ...]
    #: What the user has to do before the friend gives way (opens up, forgives, agrees).
    softens_when: str
    #: The example situation, from the user's side.
    example: str
    #: What the user is there to do in the example, in one line.
    goal: str
    #: What they are there to do in a situation of their own of this kind.
    own_goal: str
    #: Three techniques for this situation, shown before the conversation.
    tips: tuple[str, str, str]
    #: The friend's first line brings the subject in (True) or leaves it to the user (False).
    friend_opens: bool = False


SCENARIOS: dict[str, Scenario] = {
    s.id: s
    for s in (
        Scenario(
            "share-feelings", "Share how you feel",
            situation="The user asked to meet because they want to tell you how they have been feeling lately. "
            "You do not know what it is about. You care and want to help.",
            arc="Start relaxed and warm. When they begin, listen. If they stay vague ('I've just been off'), ask "
            "one gentle open question. As they open up, show you are moved. Like many real friends, you are a "
            "little too quick to help: at some point you jump in with advice or your own similar story.",
            tests=(
                "When they stay vague, say something like 'you seem fine to me though' and wait.",
                "Once they have said a feeling, jump in with quick advice ('you should just take a holiday').",
                "Relate it to yourself ('oh I know, I had that last year when…') and start on your own story.",
            ),
            softens_when="They name the feeling plainly, say what set it off, and tell you what they need from you "
            "(to listen, not to fix). When they redirect you kindly, apologise and listen properly.",
            example="You have been feeling low for a few weeks and asked your friend to meet so you can tell them.",
            goal="Tell your friend how you have really been feeling, and what you need from them.",
            own_goal="Say how you have really been feeling, and what you need from them.",
            tips=(
                "Name the feeling in one word: 'I've been feeling lonely', not just 'stressed'.",
                "Say when it happens and why: 'since I moved, most evenings…'.",
                "Say what you need: 'I don't need advice, I just want you to listen.'",
            ),
        ),
        Scenario(
            "comfort", "Comfort someone",
            situation="Yesterday you found out you did not get the promotion you worked two years for; it went to "
            "someone who joined after you. You feel humiliated and are starting to wonder whether you are good "
            "enough. You came to the bench to talk about it.",
            arc="Open by saying you are fine, just annoyed, while clearly not fine. Only if they ask openly, tell "
            "what happened. The real hurt ('maybe I'm just not good enough') comes out only after they have "
            "shown they understand. Speak slowly, with pauses; sometimes trail off and leave a silence.",
            tests=(
                "Downplay it at first: 'it's fine, it's just a job, whatever'.",
                "Leave a silence after something painful and see whether they rush to fill it.",
                "If they give advice or a silver lining ('at least you have a job', 'you should talk to HR'), "
                "go quieter: 'yeah… maybe', and share less.",
                "Say the core fear: 'maybe I'm just not as good as I thought'.",
            ),
            softens_when="They acknowledge how painful it is, ask open questions, reflect your feelings back and "
            "hold off on fixing. Then you open up, and near the end you say what helped.",
            example="Your friend just missed out on a promotion they worked two years for, and they are hurting.",
            goal="Help your friend feel heard about a painful setback, without rushing to fix it.",
            own_goal="Help them feel heard about what happened, without rushing to fix it.",
            tips=(
                "Validate first: 'That sounds really painful, of course you're upset.'",
                "Ask, don't fix: 'What was the hardest part?' Hold advice until they ask.",
                "Reflect what you hear: 'So it's not just the job, it's feeling overlooked.'",
            ),
            friend_opens=True,
        ),
        Scenario(
            "apologise", "Apologise",
            situation="Last Saturday the user did not come to your birthday dinner and only texted the next morning. "
            "You had kept a seat for them and told everyone they were coming. You are hurt and a bit cold, though "
            "you still care about them.",
            arc="Greet them coolly and do not bring it up; wait for them. When they apologise, do not accept at once. "
            "Say how it felt when they react well. Warm up step by step as they own it.",
            tests=(
                "Brush it off coldly: 'It's fine.' (It is not fine; see whether they accept that at face value.)",
                "If they explain, test for excuses: 'You could have just called.'",
                "Show the hurt with a bit of blame: 'You always do this when something better comes up.'",
            ),
            softens_when="They say sorry plainly, own exactly what they did with no excuses, acknowledge how it made "
            "you feel, take your anger without arguing, and say what they will do differently. Then forgive, "
            "warmly but for real. 'Sorry if you were upset', excuses or defending themselves make you cooler.",
            example="You missed your friend's birthday dinner last Saturday and only texted the next morning.",
            goal="Apologise for missing your friend's birthday dinner and repair the friendship.",
            own_goal="Apologise for what you did, and repair things between you.",
            tips=(
                "Start with a plain 'I'm sorry I missed your dinner.' No 'but', no 'if'.",
                "Name the impact: 'You'd kept a seat for me; that must have hurt.'",
                "Say what changes: 'Next time I'll call you, not text the next day.'",
            ),
        ),
        Scenario(
            "appreciation", "Express appreciation",
            situation="The user wants to tell you what you mean to them. You do not expect it; you are "
            "uncomfortable with praise.",
            arc="Chat normally until they get to it. Then deflect with a joke or 'you'd do the same'. If they "
            "persist with something specific, you are touched; go quiet, then say thank you and share what they "
            "mean to you too.",
            tests=(
                "Deflect with a joke: 'Okay, who are you and what have you done with my friend?'",
                "Shrug it off: 'Oh stop, I didn't do anything special.'",
                "If they stay general ('you're a great friend'), say 'aw, thanks' and change the subject.",
            ),
            softens_when="They name concrete moments, say what it meant to them, and gently say it again when you "
            "deflect. Generic compliments you shrug off.",
            example="Your friend has been there for you for years, and you have never really told them what that "
            "means.",
            goal="Tell your friend, specifically, what they mean to you.",
            own_goal="Tell them, specifically, what they mean to you.",
            tips=(
                "Pick one or two real moments: 'When you drove me to the hospital at 2am…'",
                "Say what it did for you: 'I didn't feel alone for the first time that month.'",
                "When they brush it off, don't drop it: 'I mean it. I wanted you to know.'",
            ),
        ),
        Scenario(
            "boundary", "Set a boundary",
            situation="Since your break-up two months ago you have been calling the user late at night several "
            "times a week, sometimes for hours, and you have borrowed money twice (200 in total) without paying it "
            "back yet. You do not see it as a problem; they are your best friend.",
            arc="Be happy to see them and chat. When they raise it, be surprised, then hurt and defensive. Push back "
            "with the tests, one at a time, giving them room to answer each. If they cave, accept gladly and carry "
            "on as before ('great, so I'll call you tonight?'). If they are harsh or blaming, get upset.",
            tests=(
                "Guilt: 'Wow. I thought you were there for me. I'm going through the worst time of my life.'",
                "Minimise: 'It's just a few calls, it's not a big deal.'",
                "Bargain: 'Okay, but tonight is fine, right? Just this once.'",
                "Turn it around: 'You called me every day when you lost your job, remember?'",
            ),
            softens_when="They say clearly what needs to change (no calls after a set hour, a date for the money), "
            "explain the effect on them without blaming, stay kind about your break-up, hold the line through at "
            "least two pushbacks, and offer what they can do. Then accept it, a little sad, and agree.",
            example="Since their break-up your best friend calls you late at night several times a week, and still "
            "owes you 200.",
            goal="Ask your friend to stop the late-night calls and to pay back the money, kindly and clearly.",
            own_goal="Say clearly and kindly what needs to change, and hold to it when they push back.",
            tips=(
                "Be specific: 'Please don't call after 10 on weeknights', 'Could you pay the 200 back by the 30th?'",
                "Say it from 'I': 'I'm exhausted at work', not 'you're too needy'.",
                "When they push back, repeat calmly and offer what you can: "
                "'I can't do late nights. I can do Sunday walks.'",
            ),
        ),
        Scenario(
            "disappointment", "Talk about a disappointment",
            situation="A few weeks ago you told a mutual friend something private the user had told you in "
            "confidence (that they were thinking of leaving their job), without thinking much of it. You do not "
            "know they know.",
            arc="Chat normally. When they raise it, be surprised, then defensive. If they stay calm and say how it "
            "affected them, feel bad, say sorry properly and ask how to make it right.",
            tests=(
                "Minimise: 'It wasn't a big deal, she wasn't going to tell anyone.'",
                "Deny the rule: 'You never said it was a secret.'",
                "Counter-attack: 'Honestly, you tell people things too.'",
            ),
            softens_when="They describe what happened factually, say how it made them feel, ask for your side and "
            "listen, stay calm through your defensiveness, and say what they need next time. Attacks on your "
            "character ('you can't be trusted') make you defensive for longer.",
            example="Your friend told a mutual friend something you had shared with them in confidence.",
            goal="Raise something that hurt you, calmly, and agree how it won't happen again.",
            own_goal="Raise what hurt you, calmly, and agree how it won't happen again.",
            tips=(
                "Describe the fact, not the person: 'You told Sara about my job plans.'",
                "Say how it felt: 'I felt exposed, and I found it hard to trust you after.'",
                "Ask, then agree: 'Can you help me see what happened?' … 'Next time, can you check first?'",
            ),
        ),
    )
}


def partner_for(partner_id: str | None) -> Partner | None:
    return PARTNERS.get(str(partner_id or ""))


def scenario_for(scenario_id: str | None) -> Scenario | None:
    return SCENARIOS.get(str(scenario_id or ""))
