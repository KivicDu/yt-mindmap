"""Request/response bodies for the ADR 0014 self-check endpoints.

The answer key never leaves the server: the quiz response carries only prompts,
and the attempt refers to the cached quiz by an opaque id.
"""

from typing import Any

from pydantic import BaseModel, Field

ANSWER_FIELD = Field(default="", max_length=500)


class QuizRequest(BaseModel):
    attempt: int = Field(default=0, ge=0, le=10_000)


class IdeaQuestion(BaseModel):
    id: str
    prompt: str


class QuizResponse(BaseModel):
    attempt: int
    quiz_id: str
    targets: list[dict[str, Any]]
    questions: list[IdeaQuestion]
    ideas_available: bool
    note: str | None = None


class RecallAnswer(BaseModel):
    node_id: str = Field(min_length=1, max_length=64)
    answer: str = ANSWER_FIELD


class IdeaAnswer(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    answer: str = ANSWER_FIELD


class AttemptRequest(BaseModel):
    quiz_id: str = Field(min_length=1, max_length=64)
    attempt: int = Field(default=0, ge=0, le=10_000)
    recall: list[RecallAnswer] = Field(default_factory=list, max_length=50)
    ideas: list[IdeaAnswer] = Field(default_factory=list, max_length=20)
    # Minute ranges with the weakest answers, computed by the same helper that
    # renders the "phút trống" hint in the client. Validated, never trusted.
    weak_ranges: list[list[float]] = Field(default_factory=list, max_length=12)


class AttemptItem(BaseModel):
    id: str
    prompt: str
    answer: str
    key: str
    correct: bool
    original: bool
    overridden: bool = False


class ResultFraction(BaseModel):
    id: str
    asked: int
    correct: int
    overridden: int
    items: list[AttemptItem]


class AttemptResponse(BaseModel):
    recall: ResultFraction
    ideas: ResultFraction
    weak_ranges: list[list[float]]
    next_review_at: str | None
    message: str


class OverrideRequest(BaseModel):
    item_id: str = Field(min_length=1, max_length=64)
    correct: bool


class ReviewUpdate(BaseModel):
    enabled: bool


class ReviewState(BaseModel):
    enabled: bool
    next_review_at: str | None


class DueProject(BaseModel):
    id: str
    title: str
    node_count: int
    next_review_at: str
