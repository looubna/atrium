"""The studies behind the café's techniques, each checked in Crossref (DOI resolves, authors and year match)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Source:
    #: How it is named out loud and on the page.
    short: str
    title: str
    url: str


SOURCES: dict[str, Source] = {
    "huang2017": Source("Huang et al., 2017", "It doesn't hurt to ask: Question-asking increases liking",
                        "https://doi.org/10.1037/pspi0000097"),
    "epley2014": Source("Epley & Schroeder, 2014", "Mistakenly seeking solitude",
                        "https://doi.org/10.1037/a0037323"),
    "boothby2018": Source("Boothby et al., 2018",
                          "The liking gap in conversations: Do people like us more than we think?",
                          "https://doi.org/10.1177/0956797618783714"),
    "kardas2022": Source("Kardas, Kumar & Epley, 2022",
                         "Overly shallow?: Miscalibrated expectations create a barrier to deeper conversation",
                         "https://doi.org/10.1037/pspa0000281"),
    "aron1997": Source("Aron et al., 1997", "The experimental generation of interpersonal closeness",
                       "https://doi.org/10.1177/0146167297234003"),
    "sandstrom2014": Source("Sandstrom & Dunn, 2014",
                            "Is efficiency overrated? Minimal social interactions lead to belonging and "
                            "positive affect",
                            "https://doi.org/10.1177/1948550613502990"),
    "langer1978": Source("Langer, Blank & Chanowitz, 1978",
                         "The mindlessness of ostensibly thoughtful action: The role of 'placebic' information",
                         "https://doi.org/10.1037/0022-3514.36.6.635"),
    "flynn2008": Source("Flynn & Lake, 2008",
                        "If you need help, just ask: Underestimating compliance with direct requests for help",
                        "https://doi.org/10.1037/0022-3514.95.1.128"),
    "brooks2015": Source("Brooks, Gino & Schweitzer, 2015",
                         "Smart people ask for (my) advice: Seeking advice boosts perceptions of competence",
                         "https://doi.org/10.1287/mnsc.2014.2054"),
    "givi2024": Source("Givi & Kirk, 2024",
                       "Saying no: The negative ramifications from invitation declines are less severe than we think",
                       "https://doi.org/10.1037/pspi0000443"),
    "yeomans2020": Source("Yeomans et al., 2020",
                          "Conversational receptiveness: Improving engagement with opposing views",
                          "https://doi.org/10.1016/j.obhdp.2020.03.011"),
    "morris2002": Source("Morris et al., 2002",
                         "Schmooze or lose: Social friction and lubrication in e-mail negotiations",
                         "https://doi.org/10.1037/1089-2699.6.1.89"),
    "speed2018": Source("Speed, Goldstein & Goldfried, 2018",
                        "Assertiveness training: A forgotten evidence-based treatment",
                        "https://doi.org/10.1111/cpsp.12216"),
}


@dataclass(frozen=True, slots=True)
class Technique:
    id: str
    name: str
    #: How to do it, with a line the user can borrow.
    how: str
    #: What the studies found, in plain words, naming them.
    evidence: str
    sources: tuple[str, ...]


TECHNIQUES: dict[str, Technique] = {
    t.id: t
    for t in (
        Technique(
            "follow-up", "Ask follow-up questions",
            "Pick up on something they just said and ask about it: 'Oh, you're a nurse? What shift do you work?'",
            "People who asked more questions, especially follow-up questions, were liked more by their partners "
            "(Huang et al., 2017).",
            ("huang2017",),
        ),
        Technique(
            "liking-gap", "They'll enjoy it more than you think",
            "Before you open, remind yourself the other person will probably be glad you did. Say the first line.",
            "Commuters told to talk to a stranger enjoyed it more than they predicted (Epley & Schroeder, 2014); "
            "after a first conversation, people underestimate how much the other person liked them (Boothby et al., "
            "2018).",
            ("epley2014", "boothby2018"),
        ),
        Technique(
            "go-deeper", "Go one step deeper, and share too",
            "After the small talk, ask something a little more personal ('What got you into that?') and answer "
            "it yourself as well.",
            "Deeper conversations with strangers were less awkward and more enjoyable than people expected (Kardas, "
            "Kumar & Epley, 2022); taking turns sharing a little more each time builds closeness (Aron et al., 1997).",
            ("kardas2022", "aron1997"),
        ),
        Technique(
            "warm-moment", "Make it a moment, not a transaction",
            "With staff, smile, use a line of real talk and say thank you: 'Busy morning? Thanks for squeezing me in.'",
            "People told to have a genuine exchange with the barista felt more belonging and a better mood than "
            "those told to be efficient (Sandstrom & Dunn, 2014).",
            ("sandstrom2014",),
        ),
        Technique(
            "because", "Give a reason",
            "Add 'because' and the real reason: 'Could I swap seats, because my friend's just arrived?'",
            "Requests that came with a reason were granted far more often than the same request without one "
            "(Langer, Blank & Chanowitz, 1978).",
            ("langer1978",),
        ),
        Technique(
            "just-ask", "Just ask, directly",
            "Say exactly what you want in one sentence, then stop: 'Could you watch my laptop for two minutes?'",
            "People underestimated by about half how many strangers would say yes to a direct request (Flynn & Lake, "
            "2008).",
            ("flynn2008",),
        ),
        Technique(
            "assertive", "Firm and friendly",
            "Say what you need or think calmly, and when they push, repeat it kindly instead of arguing or giving "
            "in: 'I get it, and my answer is still no.'",
            "Assertiveness training (saying what you want clearly and respectfully) has evidence behind it across "
            "decades of trials (Speed, Goldstein & Goldfried, 2018, a review).",
            ("speed2018",),
        ),
        Technique(
            "ask-advice", "Ask for advice, specifically",
            "Ask a precise question only they can answer ('If you were starting in my shoes, would you pick the "
            "agency job or the in-house one?'), not 'any tips?'.",
            "People who asked for advice were seen as more competent, not less, especially when the question was hard "
            "and put to the person directly (Brooks, Gino & Schweitzer, 2015).",
            ("brooks2015",),
        ),
        Technique(
            "decline", "A clear, kind no",
            "Say no in the first sentence, briefly, and warmly; don't over-explain or leave a 'maybe': 'I can't lend "
            "money, and I hate saying that to you.'",
            "People who declined an invitation expected the other person to be far more upset than they really were "
            "(Givi & Kirk, 2024).",
            ("givi2024",),
        ),
        Technique(
            "receptive", "Show you heard them, then disagree",
            "Acknowledge their point, say what you agree on, then give your view softly ('I might be wrong, but...'): "
            "'I get why that worries you, and I agree some people slack off. My experience has been different...'",
            "Acknowledging the other view, stressing agreement, hedging and positive words made people seen as more "
            "receptive and more wanted as partners, even when they disagreed (Yeomans et al., 2020).",
            ("yeomans2020",),
        ),
        Technique(
            "rapport-first", "Rapport before business",
            "Spend the first part on them as a person (their week, their story), then bridge to business naturally: "
            "'Speaking of your team growing, can I ask how you handle...'",
            "In e-mail negotiations, pairs who first had a short personal phone chat reached agreement more often "
            "(Morris et al., 2002).",
            ("morris2002",),
        ),
    )
}
