"""The evidence behind everything the Brain Lab's neuroscientist asks, teaches and scores.

Every source here was looked up and verified (title, authors, year, journal, DOI or PubMed id)
in Europe PMC or Crossref on 2026-09-25; nothing is cited from memory. The questions she asks
follow established, researched methods (the protocol below), the techniques she teaches are in
expert.TECHNIQUES, and the feedback scores each competency against its own method (BASES).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Source:
    short: str
    title: str
    journal: str
    kind: str
    url: str

    def cite(self) -> str:
        return f"{self.short} ({self.kind}, {self.journal})"


SOURCES: dict[str, Source] = {
    "jamieson2012": Source(
        "Jamieson et al., 2012",
        (
            "Mind over matter: reappraising arousal improves cardiovascular and cognitive responses "
            "to stress"
        ),
        "J Exp Psychol Gen",
        "experiment",
        "https://doi.org/10.1037/a0025719",
    ),
    "brooks2014": Source(
        "Brooks, 2014",
        (
            "Get excited: reappraising pre-performance anxiety as excitement"
        ),
        "J Exp Psychol Gen",
        "experiments",
        "https://doi.org/10.1037/a0035325",
    ),
    "bosshard2024": Source(
        "Bosshard & Gomez, 2024",
        (
            "Effectiveness of stress arousal reappraisal and stress-is-enhancing mindset "
            "interventions on task performance outcomes: a meta-analysis of randomized controlled "
            "trials"
        ),
        "Sci Rep",
        "meta-analysis",
        "https://doi.org/10.1038/s41598-024-58408-w",
    ),
    "balban2023": Source(
        "Balban et al., 2023",
        (
            "Brief structured respiration practices enhance mood and reduce physiological arousal"
        ),
        "Cell Rep Med",
        "randomised controlled trial",
        "https://doi.org/10.1016/j.xcrm.2022.100895",
    ),
    "reeves2022": Source(
        "Reeves et al., 2022",
        (
            "A Meta-Analysis of the Efficacy of Virtual Reality and In Vivo Exposure Therapy as "
            "Psychological Interventions for Public Speaking Anxiety"
        ),
        "Behav Modif",
        "meta-analysis",
        "https://doi.org/10.1177/0145445521991102",
    ),
    "gollwitzer2006": Source(
        "Gollwitzer & Sheeran, 2006",
        (
            "Implementation Intentions and Goal Achievement: A Meta\u2010analysis of Effects and Processes"
        ),
        "Advances in Experimental Social Psychology",
        "meta-analysis",
        "https://doi.org/10.1016/s0065-2601(06)38002-1",
    ),
    "wang2021": Source(
        "Wang et al., 2021",
        (
            "A Meta-Analysis of the Effects of Mental Contrasting With Implementation Intentions on "
            "Goal Attainment"
        ),
        "Front Psychol",
        "meta-analysis",
        "https://doi.org/10.3389/fpsyg.2021.565202",
    ),
    "kappes2011": Source(
        "Kappes & Oettingen, 2011",
        (
            "Positive fantasies about idealized futures sap energy"
        ),
        "Journal of Experimental Social Psychology",
        "experiments",
        "https://doi.org/10.1016/j.jesp.2011.02.003",
    ),
    "cohen2014": Source(
        "Cohen & Sherman, 2014",
        (
            "The psychology of change: self-affirmation and social psychological intervention"
        ),
        "Annu Rev Psychol",
        "review",
        "https://doi.org/10.1146/annurev-psych-010213-115137",
    ),
    "lally2010": Source(
        "Lally et al., 2010",
        (
            "How are habits formed: Modelling habit formation in the real world"
        ),
        "European Journal of Social Psychology",
        "longitudinal study",
        "https://doi.org/10.1002/ejsp.674",
    ),
    "schultz1997": Source(
        "Schultz et al., 1997",
        (
            "A neural substrate of prediction and reward"
        ),
        "Science",
        "neuroscience study",
        "https://doi.org/10.1126/science.275.5306.1593",
    ),
    "brewer2011": Source(
        "Brewer et al., 2011",
        (
            "Meditation experience is associated with differences in default mode network activity "
            "and connectivity"
        ),
        "Proc Natl Acad Sci U S A",
        "fMRI study",
        "https://doi.org/10.1073/pnas.1112029108",
    ),
    "rubak2005": Source(
        "Rubak et al., 2005",
        (
            "Motivational interviewing: a systematic review and meta-analysis"
        ),
        "Br J Gen Pract",
        "meta-analysis",
        "https://pubmed.ncbi.nlm.nih.gov/15826439/",
    ),
    "piccirillo2016": Source(
        "Piccirillo et al., 2016",
        (
            "Safety Behaviors in Adults With Social Anxiety: Review and Future Directions"
        ),
        "Behav Ther",
        "review",
        "https://doi.org/10.1016/j.beth.2015.11.005",
    ),
    "locke2002": Source(
        "Locke & Latham, 2002",
        (
            "Building a practically useful theory of goal setting and task motivation. A 35-year "
            "odyssey"
        ),
        "Am Psychol",
        "review of 35 years of research",
        "https://doi.org/10.1037//0003-066x.57.9.705",
    ),
    "bandura1977": Source(
        "Bandura, 1977",
        (
            "Self-efficacy: toward a unifying theory of behavioral change"
        ),
        "Psychol Rev",
        "theory",
        "https://doi.org/10.1037//0033-295x.84.2.191",
    ),
    "hattie2007": Source(
        "Hattie & Timperley, 2007",
        (
            "The Power of Feedback"
        ),
        "Review of Educational Research",
        "review",
        "https://doi.org/10.3102/003465430298487",
    ),
}


@dataclass(frozen=True, slots=True)
class Question:
    """A kind of question she asks, how, and the method it comes from."""

    method: str
    ask: str
    examples: tuple[str, ...]
    sources: tuple[str, ...]


#: The consultation's questions, in the order they are usually needed. She asks one at a time.
PROTOCOL: tuple[Question, ...] = (
    Question(
        "Motivational interviewing: open questions and reflections",
        "Ask open questions, then reflect back what you heard before the next question; affirm effort.",
        ("What brings you in today?", "What happens when you try?", "So part of you wants to speak up, and part "
         "of you is protecting you from looking foolish?"),
        ("rubak2005",),
    ),
    Question(
        "The cognitive model of social anxiety: situation, body, thoughts, safety behaviours",
        "Map one recent situation: what happened in the body, what they thought would happen, and what they did "
        "to feel safer (staying silent, over-preparing, avoiding eye contact, speaking fast). Safety behaviours "
        "keep the fear going, so name them gently.",
        ("Take me to the last time it happened: where were you?", "What did you notice in your body?",
         "What were you afraid would happen?", "What do you do to get through it — anything to feel safer?"),
        ("piccirillo2016",),
    ),
    Question(
        "Importance and confidence rulers (self-efficacy)",
        "Ask for two numbers from 0 to 10, then ask why not lower, and what would raise it by one.",
        ("On a scale of 0 to 10, how important is this to you?", "And how confident are you that you can do it?",
         "Why a 4 and not a 2?", "What would move it to a 5?"),
        ("rubak2005", "bandura1977"),
    ),
    Question(
        "WOOP: mental contrasting with implementation intentions",
        "Walk through Wish, Outcome, Obstacle (inside them), Plan, in that order, with their words.",
        ("What is your wish for the next month?", "What would be the best outcome? Picture it.",
         "What is the main thing inside you that stands in the way?",
         "When that happens, what will you do? Let's say it as 'If…, then I will…'"),
        ("wang2021", "kappes2011", "gollwitzer2006"),
    ),
    Question(
        "Specific, measurable goals",
        "Turn a vague wish ('be more confident') into something they could see happen.",
        ("What would you be doing differently if this worked?", "How often, where, by when?"),
        ("locke2002",),
    ),
)

#: What each feedback competency is measured against, and where that standard comes from.
BASES: dict[str, tuple[str, tuple[str, ...]]] = {
    "brainlab.self_insight": ("the cognitive model: situation, body, thoughts, safety behaviours", ("piccirillo2016",)),
    "brainlab.specific_goal": ("goal-setting theory: specific, measurable goals", ("locke2002",)),
    "brainlab.obstacle": ("mental contrasting: naming the inner obstacle", ("wang2021", "kappes2011")),
    "brainlab.plan_quality": ("implementation intentions: a specific cue and a specific action", ("gollwitzer2006",)),
    "brainlab.engagement": ("self-efficacy: mastery through trying it, not only hearing about it", ("bandura1977",)),
}

#: How feedback is written: task-focused, with where to go next (not praise of the person).
FEEDBACK_SOURCE = "hattie2007"
