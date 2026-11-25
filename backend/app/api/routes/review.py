"""ADR 0014 self-check and the opt-in review reminder.

One check stores two countable fractions (recall and ideas), never a weighted
percentage. The answer key stays on the server; clients only see prompts and,
after grading, the key they missed.
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ai_engine import ai_engine
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.project import Project
from app.models.review_attempt import ReviewAttempt
from app.models.user import User
from app.schemas.review import (
    AttemptItem,
    AttemptRequest,
    AttemptResponse,
    DueProject,
    IdeaQuestion,
    OverrideRequest,
    QuizRequest,
    QuizResponse,
    ResultFraction,
    ReviewState,
    ReviewUpdate,
)
from app.services import review as review_service
from app.services import sharing as sharing_service
from node_tree import clean_label, count_nodes, iter_nodes, tree_to_markdown

router = APIRouter(tags=["review"])

_NOT_FOUND = HTTPException(status_code=404, detail="project_not_found")
_FORBIDDEN = HTTPException(status_code=403, detail="edit_not_allowed")
_QUIZ_EXPIRED = HTTPException(status_code=400, detail="quiz_expired")


def _editable_project(db: Session, project_id: str, user: User) -> Project:
    """Owner, invited editor or editor-link holder — the same rule as node edits."""
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise _NOT_FOUND
    role = sharing_service.role_for(db, project, user)
    if not sharing_service.can_edit(role):
        raise _FORBIDDEN
    return project


def _format_time(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _grade(expected: str, learner: str) -> tuple[bool, float]:
    """Deterministic first; the model only breaks the ambiguous tie."""
    verdict, score = review_service.grade_answer(learner, expected)
    if verdict == "ambiguous":
        model = ai_engine.grade_idea(expected, learner)
        if model is not None:
            return model, score
    if verdict == "ambiguous":
        # Model unavailable: keep the local estimate, do not drop the item.
        return score >= (review_service.AMBIGUOUS_LOW + review_service.CORRECT_THRESHOLD) / 2, score
    return verdict == "correct", score


def _fraction(row: ReviewAttempt | None) -> ResultFraction:
    items = row.items if row is not None else []
    return ResultFraction(
        id=row.id if row is not None else "",
        asked=len(items),
        correct=sum(1 for item in items if item.get("correct")),
        overridden=sum(1 for item in items if item.get("overridden")),
        items=[AttemptItem(**item) for item in items],
    )


@router.post("/projects/{project_id}/quiz", response_model=QuizResponse)
def create_quiz(
    project_id: str,
    body: QuizRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _editable_project(db, project_id, user)
    targets = review_service.sample_target_nodes(project.nodes or [], body.attempt)

    if len(targets) < review_service.MIN_TARGETS:
        return QuizResponse(
            attempt=body.attempt,
            quiz_id="",
            targets=[],
            questions=[],
            ideas_available=False,
            note="Bài này quá ngắn để tự kiểm.",
        )

    markdown = tree_to_markdown(project.nodes or [])

    def generate(_markdown: str) -> list[dict[str, str]]:
        return ai_engine.generate_quiz(markdown)["questions"]

    quiz_id, questions, _ = review_service.collect_quiz(project.id, markdown, generate)
    return QuizResponse(
        attempt=body.attempt,
        quiz_id=quiz_id,
        targets=targets,
        questions=[IdeaQuestion(id=item["id"], prompt=item["prompt"]) for item in questions],
        ideas_available=bool(questions),
        note=(
            None
            if questions
            else "Câu hỏi ý chính đang không khả dụng. Bạn vẫn có thể kiểm tra các nhánh."
        ),
    )


@router.post("/projects/{project_id}/attempt", response_model=AttemptResponse)
def submit_attempt(
    project_id: str,
    body: AttemptRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _editable_project(db, project_id, user)
    questions = review_service.quiz_for_attempt(body.quiz_id, project.id)
    if questions is None:
        raise _QUIZ_EXPIRED

    by_id = {str(node.get("id")): node for node in iter_nodes(project.nodes or [])}

    recall_items: list[dict[str, Any]] = []
    for answer in body.recall:
        node = by_id.get(answer.node_id)
        if node is None:
            continue
        parent = by_id.get(str(node.get("parentId") or ""))
        parent_label = clean_label(parent.get("label")) if parent and parent.get("label") else ""
        stamp = node.get("time")
        when = _format_time(float(stamp)) if isinstance(stamp, (int, float)) else ""
        label = clean_label(node.get("label"))
        note = clean_label(node.get("note"))
        verdict, _, best_key = review_service.grade_node_answer(answer.answer, label, note)
        correct = verdict == "correct"
        if verdict == "ambiguous":
            model = ai_engine.grade_idea(best_key, answer.answer)
            if model is not None:
                correct = model
        recall_items.append(
            {
                "id": answer.node_id,
                "prompt": f"{when} · {parent_label}" if when else parent_label or "Nhánh",
                "answer": answer.answer,
                "key": " · ".join(part for part in (label, note) if part),
                "correct": correct,
                "original": correct,
                "overridden": False,
            }
        )

    expected_by_id = {item["id"]: item for item in questions}
    idea_items: list[dict[str, Any]] = []
    for answer in body.ideas:
        question = expected_by_id.get(answer.id)
        if question is None:
            continue
        correct, _ = _grade(question["expected"], answer.answer)
        idea_items.append(
            {
                "id": question["id"],
                "prompt": question["prompt"],
                "answer": answer.answer,
                "key": question["expected"],
                "correct": correct,
                "original": correct,
                "overridden": False,
            }
        )

    recall_row = None
    if recall_items:
        recall_row = ReviewAttempt(
            project_id=project.id,
            user_id=user.id,
            kind="recall",
            asked=len(recall_items),
            correct=sum(1 for item in recall_items if item["correct"]),
            weak_ranges=review_service.clean_weak_ranges(body.weak_ranges),
            items=recall_items,
        )
        db.add(recall_row)

    ideas_row = None
    if idea_items:
        ideas_row = ReviewAttempt(
            project_id=project.id,
            user_id=user.id,
            kind="ideas",
            asked=len(idea_items),
            correct=sum(1 for item in idea_items if item["correct"]),
            items=idea_items,
        )
        db.add(ideas_row)

    # Flush so the generated ids exist before we build the response.
    db.flush()
    recall = _fraction(recall_row)
    ideas = _fraction(ideas_row)
    if project.next_review_at is not None and recall.asked + ideas.asked:
        total_correct = recall.correct + ideas.correct
        total_asked = recall.asked + ideas.asked
        project.next_review_at = review_service.schedule_after_attempt(
            project.next_review_at, weak=total_correct * 2 < total_asked
        )

    db.commit()

    message = f"Bạn dựng lại đúng {recall.correct}/{recall.asked} nhánh"
    if ideas.asked:
        message += f" và nắm {ideas.correct}/{ideas.asked} ý chính"
    message += "."
    ranges = recall_row.weak_ranges if recall_row is not None else []
    if ranges:
        weakest = ranges[0]
        message += f" Phần yếu nhất: {_format_time(weakest[0])}–{_format_time(weakest[1])}."

    return AttemptResponse(
        recall=recall,
        ideas=ideas,
        weak_ranges=ranges,
        next_review_at=project.next_review_at.isoformat() if project.next_review_at else None,
        message=message,
    )


@router.patch("/review/attempts/{attempt_id}", response_model=ResultFraction)
def override_mark(
    attempt_id: str,
    body: OverrideRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The learner is the authority on their own understanding."""
    row = db.get(ReviewAttempt, attempt_id)
    if row is None or row.user_id != user.id:
        raise _NOT_FOUND
    items = list(row.items or [])
    target = next((item for item in items if item.get("id") == body.item_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="item_not_found")

    # `original` is the grader's mark; overriding means disagreeing with it,
    # not merely toggling the current display state.
    target["correct"] = body.correct
    target["overridden"] = body.correct != bool(target.get("original", body.correct))
    row.items = items
    row.correct = sum(1 for item in items if item.get("correct"))
    row.overridden = sum(1 for item in items if item.get("overridden"))
    db.commit()
    return _fraction(row)


@router.patch("/projects/{project_id}/review", response_model=ReviewState)
def toggle_review(
    project_id: str,
    body: ReviewUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _editable_project(db, project_id, user)
    project.next_review_at = review_service.start_schedule() if body.enabled else None
    db.commit()
    return ReviewState(
        enabled=project.next_review_at is not None,
        next_review_at=project.next_review_at.isoformat() if project.next_review_at else None,
    )


@router.get("/review/due", response_model=list[DueProject])
def due_projects(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Computed lazily on dashboard read; no scheduler process (ADR 0014 §6)."""
    now = datetime.now(UTC)
    rows = db.scalars(
        select(Project).where(
            Project.user_id == user.id,
            Project.deleted_at.is_(None),
            Project.next_review_at.is_not(None),
            Project.next_review_at <= now,
        )
    )
    return [
        DueProject(
            id=row.id,
            title=row.title,
            node_count=count_nodes(row.nodes or []),
            next_review_at=row.next_review_at.isoformat(),
        )
        for row in rows
    ]
