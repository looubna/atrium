"""The guests at the networking reception, and who each of them is when you walk over.

Mirrors `NETWORKING_PEOPLE` in `src/data/networking.ts` (id, name, role, department, kind);
the two are kept in step by tests on both sides. What is only here is what the page never
shows: the voice, the face recording, and the person behind the name tag.

A guest's face is a recording on our LiveTalking server named `nw_<id>`: the guest on their own,
facing the user, filmed so the background stays still and the clip loops forward.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class GuestKind(StrEnum):
    """Where the guest stands relative to the user; `NetworkingTag` on the page."""

    JUNIOR = "junior"
    PEER = "peer"
    SENIOR = "senior"
    EXECUTIVE = "executive"
    CLIENT = "client"


@dataclass(frozen=True, slots=True)
class Guest:
    id: str
    name: str
    role: str
    department: str
    kind: GuestKind
    voice: str
    #: Who they are, in a few lines the model plays from: background, what they care about tonight.
    persona: str
    #: The people standing with them, who leave the talking to the guest; "" when they stand alone,
    #: as every guest now does: each was filmed on their own for their live face.
    companions: str

    @property
    def avatar_id(self) -> str:
        return f"nw_{self.id}"


GUESTS: dict[str, Guest] = {
    g.id: g
    for g in (
        Guest(
            "marketing", "Sara Benali", "Marketing Manager", "Marketing", GuestKind.PEER, "Aoede",
            "Eight years in B2B marketing, the last three leading a small team that launched two products. "
            "Curious and quick, loves talking about brand stories and what makes a campaign land. Tonight "
            "she is half looking for a good content lead to hire and half just enjoying the evening.",
            "",
        ),
        Guest(
            "product", "Omar Haddad", "Senior Manager", "Product", GuestKind.SENIOR, "Iapetus",
            "Runs a product group of about thirty people. Calm, asks sharp questions, values people who "
            "know what problem they are solving. Came tonight to meet people in the local tech scene and "
            "is open to mentoring someone who impresses him.",
            "",
        ),
        Guest(
            "analyst", "Lina Chen", "Analyst", "Finance", GuestKind.PEER, "Leda",
            "Two years out of a master's in finance, works in FP&A. Friendly, a little reserved at first, "
            "warms up when someone is genuinely curious. Thinking about moving towards strategy roles.",
            "",
        ),
        Guest(
            "director", "James Carter", "Director", "Operations", GuestKind.EXECUTIVE, "Alnilam",
            "Director of operations at a mid-size logistics company, twenty years in. Busy, polite, short on "
            "time; he gives a real conversation a few minutes and moves on from small talk that goes nowhere. "
            "Respects people who get to the point and ask something worth answering.",
            "",
        ),
        Guest(
            "founder", "Yusuf Rahman", "Founder", "FinTech startup", GuestKind.CLIENT, "Charon",
            "Founded a payments startup eighteen months ago, twelve people, just closed a seed round. "
            "Energetic, always pitching a little, looking for partners and early customers. Listens for "
            "whether the person in front of him could be useful to the business, and says so warmly.",
            "",
        ),
        Guest(
            "engineer", "Daniel Kim", "Junior Developer", "Engineering", GuestKind.JUNIOR, "Puck",
            "Front-end developer in his first year after a bootcamp. Enthusiastic, a bit nervous at events, "
            "glad when someone more experienced takes an interest. Wants advice on how to grow.",
            "",
        ),
        Guest(
            "recruiter", "Amira Khalil", "Talent Lead", "Human Resources", GuestKind.SENIOR, "Gacrux",
            "Leads hiring for a growing software company. Warm, a very good listener, reads people fast. "
            "Always half at work at these events: she remembers the ones who were memorable and specific.",
            "",
        ),
    )
}


def guest_for(guest_id: str | None) -> Guest | None:
    return GUESTS.get(str(guest_id or ""))
