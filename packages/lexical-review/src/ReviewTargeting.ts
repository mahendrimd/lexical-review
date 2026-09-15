import { $isReviewBoundaryNode } from "./ReviewBoundaryNode";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalNode,
  type ParagraphNode,
  type PointType,
  type RangeSelection,
  type TextNode,
} from "lexical";
import {
  $isReviewFragmentNode,
  $isReviewDeletionNode,
  $isReviewFormattingNode,
  $isReviewInsertionNode,
  getChildIndex,
  getTextChildren,
  isReviewElementNode,
  isRootParagraph,
  type ReviewElementNode,
  type ReviewFragmentNode,
} from "./ReviewNodes";
import {
  buildAcceptedMap,
  buildProposalMap,
  getAcceptedOffset,
  getProposalOffset,
  isSameProposalNode,
  isolateSpanNodes,
  overlappingSlices,
  proposalMapOf,
  proposalRunRange,
  type AcceptedMap,
  type ProposalMap,
} from "./ReviewTargetMaps";
import {
  refusal,
  type Preparation,
  type ReviewIntentRefusal,
} from "./ReviewIntent";

import { isValidProposalId } from "./ProposalIdentity";
import {
  collectProposalNodes,
  inspectCollectedFragmentGroup,
  inspectFragmentGroup,
  type CollectedProposalNodes,
} from "./ReviewProposalCollection";

const SUPPORTED_TEXT_FORMAT_MASK = 0b1111;

type AcceptedPoint = Readonly<{
  association: "accepted";
  childIndex: number;
  node: TextNode | null;
  offset: number;
  paragraph: ParagraphNode;
}>;

type ProposalPoint = Readonly<{
  association: "proposal";
  childIndex: number;
  node: TextNode | null;
  offset: number;
  paragraph: ParagraphNode;
  wrapper: ReviewElementNode;
}>;

type SelectionPoint = AcceptedPoint | ProposalPoint;

type SelectionInspection = Readonly<{
  anchor: SelectionPoint;
  backward: boolean;
  collapsed: boolean;
  focus: SelectionPoint;
  selection: RangeSelection;
}>;

type ProposalSpan = Readonly<{
  end: number;
  map: ProposalMap;
  start: number;
}>;

type AcceptedSpan = Readonly<{
  end: number;
  map: AcceptedMap;
  start: number;
}>;

type RootProposalContext = Readonly<{
  paragraph: ParagraphNode;
  wrapper: ReviewElementNode;
}>;

function getRootProposalContext(
  node: LexicalNode | null | undefined,
): RootProposalContext | null {
  if (!isReviewElementNode(node)) {
    return null;
  }
  const paragraph = node.getParent();
  return isRootParagraph(paragraph) ? { paragraph, wrapper: node } : null;
}

/** Paragraph placement rule shared by live targeting and serialized validation; unify the two checks once serialized validation can query this seam. */
export function validateParagraphStructure(
  paragraph: ParagraphNode,
): ReviewIntentRefusal | null {
  for (const child of paragraph.getChildren()) {
    if ($isReviewBoundaryNode(child)) {
      const boundaries = paragraph.getChildren().filter($isReviewBoundaryNode);
      const left = paragraph.getPreviousSibling();
      const next = paragraph.getNextSibling();
      if (
        boundaries.length !== 1 ||
        (child.getKind() === "split" &&
          (child.getIndexWithinParent() !== 0 ||
            !isRootParagraph(left) ||
            left
              .getChildren()
              .some(
                (node) =>
                  $isReviewBoundaryNode(node) && node.getKind() === "merge",
              ))) ||
        (child.getKind() === "merge" &&
          isRootParagraph(next) &&
          next
            .getChildren()
            .some(
              (node) =>
                $isReviewBoundaryNode(node) && node.getKind() === "split",
            ))
      )
        return refusal(
          "invalid-structural-target",
          "Invalid or conflicting pending paragraph boundary attachment.",
        );
      continue;
    }
    if ($isTextNode(child)) {
      if (hasUnsupportedTextFormatting(child)) {
        return refusal(
          "unsupported-formatting",
          "Review editing supports bold, italic, strikethrough, and underline text without inline styles or token modes.",
        );
      }
      continue;
    }
    if (isReviewElementNode(child)) {
      const textChildren = getTextChildren(child);
      if (textChildren === null) {
        return refusal(
          "invalid-structural-target",
          "Review editing supports only direct paragraph text and text-only proposal wrappers.",
        );
      }
      if (textChildren.some(hasUnsupportedTextFormatting)) {
        return refusal(
          "unsupported-formatting",
          "Review editing supports bold, italic, strikethrough, and underline text without inline styles or token modes.",
        );
      }
      continue;
    }
    return refusal(
      "invalid-structural-target",
      "Review editing supports only direct paragraph text and text-only proposal wrappers.",
    );
  }
  return null;
}

function hasUnsupportedTextFormatting(node: TextNode): boolean {
  return (
    (node.getFormat() & ~SUPPORTED_TEXT_FORMAT_MASK) !== 0 ||
    node.getDetail() !== 0 ||
    node.getMode() !== "normal" ||
    node.getStyle() !== ""
  );
}

function validateSelectionFormatting(
  selection: RangeSelection,
): ReviewIntentRefusal | null {
  return (selection.format & ~SUPPORTED_TEXT_FORMAT_MASK) !== 0 ||
    selection.style !== ""
    ? refusal(
        "unsupported-formatting",
        "Review editing supports bold, italic, strikethrough, and underline text without inline styles.",
      )
    : null;
}

export function isTextBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) {
    return true;
  }
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

export function previousCharacterOffset(text: string, offset: number): number {
  const previous = offset - 1;
  if (
    previous > 0 &&
    text.charCodeAt(previous) >= 0xdc00 &&
    text.charCodeAt(previous) <= 0xdfff &&
    text.charCodeAt(previous - 1) >= 0xd800 &&
    text.charCodeAt(previous - 1) <= 0xdbff
  ) {
    return previous - 1;
  }
  return previous;
}

export function nextCharacterOffset(text: string, offset: number): number {
  const next = offset + 1;
  if (
    next < text.length &&
    text.charCodeAt(offset) >= 0xd800 &&
    text.charCodeAt(offset) <= 0xdbff &&
    text.charCodeAt(next) >= 0xdc00 &&
    text.charCodeAt(next) <= 0xdfff
  ) {
    return next + 1;
  }
  return next;
}

function classifyPoint(
  point: PointType,
  structural = false,
): Preparation<SelectionPoint> {
  const node = point.getNode();
  if (point.type === "text") {
    if (!$isTextNode(node)) {
      return refusal(
        "invalid-structural-target",
        "A text selection point must identify a Lexical text node.",
      );
    }
    const text = node.getTextContent();
    if (
      !Number.isInteger(point.offset) ||
      point.offset < 0 ||
      point.offset > text.length ||
      !isTextBoundary(text, point.offset)
    ) {
      return refusal(
        "invalid-structural-target",
        "The text selection point is outside a supported Unicode text boundary.",
      );
    }
    const parentNode: LexicalNode | null = node.getParent();
    if (isRootParagraph(parentNode)) {
      const structure = validateParagraphStructure(parentNode);
      if (structure !== null) {
        return structure;
      }
      const childIndex = getChildIndex(parentNode, node);
      if (childIndex === null) {
        return refusal(
          "invalid-structural-target",
          "The selected text node is not attached to its paragraph.",
        );
      }
      return {
        status: "ready",
        value: {
          association: "accepted",
          childIndex,
          node,
          offset: point.offset,
          paragraph: parentNode,
        },
      };
    }
    const proposal = getRootProposalContext(parentNode);
    if (proposal !== null) {
      const { paragraph, wrapper: parent } = proposal;
      const structure = validateParagraphStructure(paragraph);
      if (structure !== null) {
        return structure;
      }
      const childIndex = getChildIndex(paragraph, parent);
      if (childIndex === null) {
        return refusal(
          "invalid-structural-target",
          "The selected proposal wrapper is not attached to its paragraph.",
        );
      }
      const textChildren = getTextChildren(parent);
      if (textChildren === null) {
        return refusal(
          "invalid-structural-target",
          "The selected proposal wrapper has unsupported live children.",
        );
      }
      return {
        status: "ready",
        value: {
          association: "proposal",
          childIndex,
          node,
          offset: point.offset,
          paragraph,
          wrapper: parent,
        },
      };
    }
    return refusal(
      "invalid-structural-target",
      "Review editing supports only direct paragraph text and proposal text.",
    );
  }

  if (!$isElementNode(node)) {
    return refusal(
      "invalid-structural-target",
      "An element selection point must identify a Lexical element node.",
    );
  }
  if (!Number.isInteger(point.offset) || point.offset < 0) {
    return refusal(
      "invalid-structural-target",
      "The element selection point has an invalid child offset.",
    );
  }
  const proposal = getRootProposalContext(node);
  if (proposal !== null) {
    const { paragraph, wrapper } = proposal;
    const textChildren = getTextChildren(wrapper);
    if (textChildren === null || point.offset > textChildren.length) {
      return refusal(
        "invalid-structural-target",
        "The proposal element point does not identify a supported child boundary.",
      );
    }
    const structure = validateParagraphStructure(paragraph);
    if (structure !== null) {
      return structure;
    }
    const childIndex = getChildIndex(paragraph, node);
    if (childIndex === null) {
      return refusal(
        "invalid-structural-target",
        "The selected proposal wrapper is not attached to its paragraph.",
      );
    }
    return {
      status: "ready",
      value: {
        association: "proposal",
        childIndex,
        node: null,
        offset: textChildren
          .slice(0, point.offset)
          .reduce((total, child) => total + child.getTextContentSize(), 0),
        paragraph,
        wrapper,
      },
    };
  }
  if (isRootParagraph(node)) {
    const structure = validateParagraphStructure(node);
    if (structure !== null) {
      return structure;
    }
    const children = node.getChildren();
    if (point.offset > children.length) {
      return refusal(
        "invalid-structural-target",
        "The paragraph element point is outside its child range.",
      );
    }
    const left = children[point.offset - 1];
    const right = children[point.offset];
    const fragment = $isReviewFragmentNode(right)
      ? right
      : $isReviewFragmentNode(left)
        ? left
        : null;
    if (fragment) {
      const group = inspectFragmentGroup(fragment.getProposalId());
      if (group.status !== "ready") return group;
      if (!(
        (right === group.value.wrappers[0] && left !== fragment) ||
        (left === group.value.wrappers.at(-1) && right !== fragment)
      ))
        return refusal(
          "ambiguous-boundary",
          "An internal fragment boundary requires proposal-side association.",
        );
    }

    if (
      !structural &&
      !$isReviewBoundaryNode(left) &&
      !$isReviewBoundaryNode(right) &&
      !$isReviewFragmentNode(left) &&
      !$isReviewFragmentNode(right) &&
      (isReviewElementNode(left) || isReviewElementNode(right))
    ) {
      return refusal(
        "ambiguous-boundary",
        "A paragraph boundary next to proposal content does not identify one editing side.",
      );
    }
    return {
      status: "ready",
      value: {
        association: "accepted",
        childIndex:
          $isReviewBoundaryNode(right) && right.getKind() === "split"
            ? point.offset + 1
            : point.offset,
        node: null,
        offset: children
          .slice(0, point.offset)
          .reduce((total, child) => total + child.getTextContentSize(), 0),
        paragraph: node,
      },
    };
  }
  return refusal(
    "invalid-structural-target",
    "Review editing supports only paragraph and proposal element points.",
  );
}

export function inspectSelection(
  structural = false,
): Preparation<SelectionInspection> {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return refusal(
      "unsupported-target",
      "Review editing requires one Lexical range selection.",
    );
  }
  const formatting = validateSelectionFormatting(selection);
  if (formatting !== null) {
    return formatting;
  }
  const anchor = classifyPoint(selection.anchor, structural);
  if (anchor.status !== "ready") {
    return anchor;
  }
  const focus = classifyPoint(selection.focus, structural);
  if (focus.status !== "ready") {
    return focus;
  }
  return {
    status: "ready",
    value: {
      anchor: anchor.value,
      backward: selection.isBackward(),
      collapsed: selection.isCollapsed(),
      focus: focus.value,
      selection,
    },
  };
}

/** Interaction targets: classified review-targeting results behind one seam. */
export type AcceptedCaretTarget = Readonly<{
  kind: "accepted-caret";
  paragraph: ParagraphNode;
  node: TextNode | null;
  offset: number;
  childIndex: number;
  selection: RangeSelection;
}>;

export type AcceptedRangeTarget = Readonly<{
  kind: "accepted-range";
  paragraph: ParagraphNode;
  start: number;
  end: number;
  backward: boolean;
  selection: RangeSelection;
}>;

export type ProposalCaretTarget = Readonly<{
  kind: "proposal-caret";
  paragraph: ParagraphNode;
  wrapper: ReviewElementNode;
  node: TextNode | null;
  offset: number;
  childIndex: number;
  proposalId: string;
  wrappers: readonly ReviewElementNode[];
  selection: RangeSelection;
}>;

export type ProposalRangeTarget = Readonly<{
  kind: "proposal-range";
  paragraph: ParagraphNode;
  proposalId: string;
  start: number;
  end: number;
  backward: boolean;
  wrappers: readonly ReviewElementNode[];
  anchorWrapper: ReviewElementNode;
  selection: RangeSelection;
}>;

export type ReviewTarget =
  | AcceptedCaretTarget
  | AcceptedRangeTarget
  | ProposalCaretTarget
  | ProposalRangeTarget;

/**
 * Shared guard climb for collapsed paragraph element carets: the live
 * selection must be a collapsed element selection on one root paragraph with
 * valid formatting and structure. Returns the paragraph, child index, and
 * selection for neighbor synthesis, else null.
 */
export function inspectElementCaretContext(): {
  node: ParagraphNode;
  childIndex: number;
  selection: RangeSelection;
} | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  if (selection.anchor.type !== "element" || selection.focus.type !== "element")
    return null;
  if (selection.anchor.key !== selection.focus.key) return null;
  const node = selection.anchor.getNode();
  if (!isRootParagraph(node)) return null;
  if (validateSelectionFormatting(selection) !== null) return null;
  if (validateParagraphStructure(node) !== null) return null;
  return { node, childIndex: selection.anchor.offset, selection };
}

/**
 * Directional deletion entry for collapsed paragraph element carets (#85).
 * Returns the accepted-side caret at the same visual position when the child
 * in the deletion direction is supported accepted text, else null. Null also
 * covers every guard failure, so all refusals stay owned by the existing
 * paths and this function is a pure allow-list with no refusal precedence.
 */
export function inspectDirectionalDeletionTarget(
  backward: boolean,
): AcceptedCaretTarget | null {
  const context = inspectElementCaretContext();
  if (context === null) return null;
  const { node, childIndex, selection } = context;
  const neighbor = node.getChildAtIndex(backward ? childIndex - 1 : childIndex);
  if (!$isTextNode(neighbor) || neighbor.getTextContentSize() === 0)
    return null;
  return {
    kind: "accepted-caret",
    paragraph: node,
    node: neighbor,
    offset: backward ? neighbor.getTextContentSize() : 0,
    childIndex: backward ? childIndex - 1 : childIndex,
    selection,
  };
}

/**
 * Shared neighbor-proposal synthesis for deletion (#86 rows 2-7, 10).
 * Returns a synthetic proposal-caret at the neighbor's edge in the deletion
 * direction when the child at neighborIndex is a supported insertion,
 * deletion, or formatting wrapper, else null. Fragment, boundary, and
 * accepted children stay with their existing paths. Pure allow-list: null
 * covers every guard failure and every unsupported neighbor. Never mints
 * identity and never resolves; the existing proposal-caret
 * preparation/commit owns mutation and caret restore.
 */
export function buildNeighborProposalCaret(
  paragraph: ParagraphNode,
  neighborIndex: number,
  backward: boolean,
  selection: RangeSelection,
): ProposalCaretTarget | null {
  const neighbor = paragraph.getChildAtIndex(neighborIndex);
  if (
    !$isReviewInsertionNode(neighbor) &&
    !$isReviewDeletionNode(neighbor) &&
    !$isReviewFormattingNode(neighbor)
  )
    return null;
  const proposalId = neighbor.getProposalId();
  if (inspectProposalKind(proposalId).status !== "ready") return null;
  // Side run: contiguous same-type same-ID wrappers around the neighbor, so
  // split sides shrink one edge without crossing into the other side.
  const children = paragraph.getChildren();
  const [startIndex, endIndex] = proposalRunRange(
    children,
    neighborIndex,
    neighbor,
  );
  const run = children.slice(startIndex, endIndex + 1);
  const wrappers = run.filter(isReviewElementNode);
  if (wrappers.length !== run.length || wrappers.length === 0) return null;
  const edgeWrapper = (backward ? wrappers.at(-1) : wrappers[0])!;
  const edgeTexts = getTextChildren(edgeWrapper);
  if (edgeTexts === null || edgeTexts.length === 0) return null;
  const edgeNode = (backward ? edgeTexts.at(-1) : edgeTexts[0])!;
  if (edgeNode.getTextContentSize() === 0) return null;
  const edgeIndex = getChildIndex(paragraph, edgeWrapper);
  if (edgeIndex === null) return null;
  return {
    kind: "proposal-caret",
    paragraph,
    wrapper: edgeWrapper,
    node: edgeNode,
    offset: backward ? edgeNode.getTextContentSize() : 0,
    childIndex: edgeIndex,
    proposalId,
    wrappers,
    selection,
  };
}

/**
 * Directional proposal entry for collapsed paragraph element carets (#86 row
 * 10). Guard-climbs the live element selection, then delegates to
 * buildNeighborProposalCaret.
 */
export function inspectDirectionalProposalDeletionTarget(
  backward: boolean,
): ProposalCaretTarget | null {
  const context = inspectElementCaretContext();
  if (context === null) return null;
  return buildNeighborProposalCaret(
    context.node,
    backward ? context.childIndex - 1 : context.childIndex,
    backward,
    context.selection,
  );
}

/** Classify the live selection into one interaction target; maps stay inside. */
export function inspectReviewTarget(): Preparation<ReviewTarget> {
  const inspection = inspectSelection();
  if (inspection.status !== "ready") return inspection;
  const { anchor, focus, backward, collapsed, selection } = inspection.value;
  if (!collapsed) {
    if (anchor.association === "proposal" && focus.association === "proposal") {
      const span = buildProposalSpan(inspection.value);
      if (span.status !== "ready") return span;
      if (span.value.start === span.value.map.total || span.value.end === 0)
        return refusal(
          "invalid-structural-target",
          "The proposal selection points cannot be ordered in the live tree.",
        );
      return {
        status: "ready",
        value: {
          kind: "proposal-range",
          paragraph: span.value.map.paragraph,
          proposalId: span.value.map.proposalId,
          start: span.value.start,
          end: span.value.end,
          backward,
          wrappers: span.value.map.wrappers,
          anchorWrapper: anchor.wrapper,
          selection,
        },
      };
    }
    const span = buildAcceptedSpan(inspection.value);
    if (span.status !== "ready") return span;
    if (span.value.start === span.value.map.total || span.value.end === 0)
      return refusal(
        "invalid-structural-target",
        "The accepted selection points cannot be resolved in the live tree.",
      );
    return {
      status: "ready",
      value: {
        kind: "accepted-range",
        paragraph: span.value.map.paragraph,
        start: span.value.start,
        end: span.value.end,
        backward,
        selection,
      },
    };
  }
  if (anchor.association === "proposal") {
    const map = buildProposalMapAroundPoint(anchor);
    if (map.status !== "ready") return map;
    return {
      status: "ready",
      value: {
        kind: "proposal-caret",
        paragraph: anchor.paragraph,
        wrapper: anchor.wrapper,
        node: anchor.node,
        offset: anchor.offset,
        childIndex: anchor.childIndex,
        proposalId: map.value.proposalId,
        wrappers: map.value.wrappers,
        selection,
      },
    };
  }
  return {
    status: "ready",
    value: {
      kind: "accepted-caret",
      paragraph: anchor.paragraph,
      node: anchor.node,
      offset: anchor.offset,
      childIndex: anchor.childIndex,
      selection,
    },
  };
}

function sameProposal(left: ProposalPoint, right: ProposalPoint): boolean {
  return (
    left.paragraph === right.paragraph &&
    isSameProposalNode(left.wrapper, right.wrapper)
  );
}

/**
 * Execution-side identity lookup behind the seam: validated live nodes for
 * resolution and proposal unwrapping. Validation-only callers use
 * inspectProposalKind; no owner walks groups for classification anymore.
 */
/**
 * Text-group validation read-only over one shared observation. The syntax
 * check runs here at the text-group stage, never hoisted ahead of fragment
 * or structural evaluation by callers. Callers that already evaluated
 * fragment placement over the same observation (the proposal directory) pass
 * it as knownFragment so the placement math runs once per classification;
 * direct callers omit it and the check runs here.
 */
export function inspectCollectedProposalGroup(
  collected: CollectedProposalNodes,
  proposalId: string,
  knownFragment?: Preparation<{
    wrappers: ReviewFragmentNode[];
    paragraphs: ParagraphNode[];
  }>,
): Preparation<{
  kind: "insertion" | "deletion" | "replacement" | "formatting" | "fragment";
  wrappers: ReviewElementNode[];
}> {
  if (!isValidProposalId(proposalId))
    return refusal(
      "invalid-proposal-id",
      "Expected a valid proposal identity.",
    );
  return validateCollectedProposalGroup(collected, knownFragment);
}

function validateCollectedProposalGroup(
  collected: CollectedProposalNodes,
  knownFragment?: Preparation<{
    wrappers: ReviewFragmentNode[];
    paragraphs: ParagraphNode[];
  }>,
): Preparation<{
  kind: "insertion" | "deletion" | "replacement" | "formatting" | "fragment";
  wrappers: ReviewElementNode[];
}> {
  const { wrappers } = collected;
  if (collected.boundaries.length > 0)
    return refusal(
      "unsafe-proposal-intersection",
      "A text proposal identity cannot also identify a structural boundary.",
    );
  if (wrappers.some($isReviewFragmentNode)) {
    const fragment = knownFragment ?? inspectCollectedFragmentGroup(collected);
    return fragment.status === "ready"
      ? {
          status: "ready",
          value: { kind: "fragment", wrappers: fragment.value.wrappers },
        }
      : fragment;
  }
  const first = wrappers[0];
  const paragraph = first?.getParent();
  if (!first || !paragraph || !isRootParagraph(paragraph))
    return refusal(
      "unsupported-target",
      "The pending proposal was not found in a supported paragraph.",
    );
  const structure = validateParagraphStructure(paragraph);
  if (structure) return structure;
  if (wrappers.some($isReviewFormattingNode)) {
    if (
      wrappers.length !== 1 ||
      !$isReviewFormattingNode(first) ||
      first
        .getAcceptedFormats()
        .map((run) => run.text)
        .join("") !== first.getTextContent()
    )
      return refusal(
        "unsafe-proposal-intersection",
        "Formatting requires one unchanged text target and one identity.",
      );
    return { status: "ready", value: { wrappers, kind: "formatting" } };
  }
  let insertionSeen = false;
  let deletionSeen = false;
  for (const [index, wrapper] of wrappers.entries()) {
    if (
      wrapper.getParent()?.getKey() !== paragraph.getKey() ||
      (index > 0 &&
        wrappers[index - 1]!.getNextSibling()?.getKey() !== wrapper.getKey()) ||
      ($isReviewDeletionNode(wrapper) && insertionSeen)
    )
      return refusal(
        "unsafe-proposal-intersection",
        "A proposal must have contiguous ordered sides in one paragraph.",
      );
    insertionSeen ||= $isReviewInsertionNode(wrapper);
    deletionSeen ||= $isReviewDeletionNode(wrapper);
  }
  return {
    status: "ready",
    value: {
      wrappers,
      kind:
        insertionSeen && deletionSeen
          ? "replacement"
          : insertionSeen
            ? "insertion"
            : "deletion",
    },
  };
}

export function inspectProposalGroup(proposalId: string): Preparation<{
  kind: "insertion" | "deletion" | "replacement" | "formatting" | "fragment";
  wrappers: ReviewElementNode[];
}> {
  if (!isValidProposalId(proposalId))
    return refusal(
      "invalid-proposal-id",
      "Expected a valid proposal identity.",
    );
  return validateCollectedProposalGroup(collectProposalNodes(proposalId));
}

function buildProposalMapAroundPoint(
  point: ProposalPoint,
): Preparation<ProposalMap> {
  const children = point.paragraph.getChildren();
  const [startIndex, endIndex] = proposalRunRange(
    children,
    point.childIndex,
    point.wrapper,
  );
  const startWrapper = children[startIndex];
  const endWrapper = children[endIndex];
  if (
    !isSameProposalNode(startWrapper, point.wrapper) ||
    !isSameProposalNode(endWrapper, point.wrapper)
  ) {
    return refusal(
      "invalid-structural-target",
      "The proposal caret is not attached to a supported proposal run.",
    );
  }
  return buildProposalMap(
    point.paragraph,
    startWrapper,
    endWrapper,
    inspectProposalGroup,
  );
}

function buildProposalSpan(
  inspection: SelectionInspection,
): Preparation<ProposalSpan> {
  if (
    inspection.anchor.association !== "proposal" ||
    inspection.focus.association !== "proposal"
  ) {
    return refusal(
      "unsafe-proposal-intersection",
      "The selection does not stay on one proposal side.",
    );
  }
  if (!sameProposal(inspection.anchor, inspection.focus)) {
    return refusal(
      "unsafe-proposal-intersection",
      "A selection may edit only one proposal identity and kind at a time.",
    );
  }
  const startPoint = inspection.backward ? inspection.focus : inspection.anchor;
  const endPoint = inspection.backward ? inspection.anchor : inspection.focus;
  const map = buildProposalMap(
    startPoint.paragraph,
    startPoint.wrapper,
    endPoint.wrapper,
    inspectProposalGroup,
  );
  if (map.status !== "ready") {
    return map;
  }
  const start = getProposalOffset(startPoint, map.value);
  const end = getProposalOffset(endPoint, map.value);
  if (start === null || end === null || end < start) {
    return refusal(
      "invalid-structural-target",
      "The proposal selection points cannot be ordered in the live tree.",
    );
  }
  return { status: "ready", value: { end, map: map.value, start } };
}

function buildAcceptedSpan(
  inspection: SelectionInspection,
): Preparation<AcceptedSpan> {
  if (
    inspection.anchor.association !== "accepted" ||
    inspection.focus.association !== "accepted"
  ) {
    return refusal(
      "unsafe-proposal-intersection",
      "The selection intersects proposal-side content.",
    );
  }
  if (inspection.anchor.paragraph !== inspection.focus.paragraph) {
    return refusal(
      "unsupported-target",
      "Accepted editing supports one same-paragraph range.",
    );
  }
  const startPoint = inspection.backward ? inspection.focus : inspection.anchor;
  const endPoint = inspection.backward ? inspection.anchor : inspection.focus;
  const startIndex = startPoint.childIndex;
  const endIndex = endPoint.node
    ? endPoint.childIndex
    : endPoint.childIndex - 1;
  if (startIndex > endIndex + 1) {
    return refusal(
      "invalid-structural-target",
      "The accepted selection points are not ordered in the paragraph.",
    );
  }
  const children = startPoint.paragraph.getChildren();
  for (let index = startIndex; index <= endIndex; index += 1) {
    const child = children[index];
    if (child !== undefined && !$isTextNode(child)) {
      return refusal(
        "unsafe-proposal-intersection",
        "The accepted range crosses pending proposal content.",
      );
    }
  }
  const map = buildAcceptedMap(startPoint.paragraph);
  const start = getAcceptedOffset(startPoint, map);
  const end = getAcceptedOffset(endPoint, map);
  if (start === null || end === null || end < start) {
    return refusal(
      "invalid-structural-target",
      "The accepted selection points cannot be resolved in the live tree.",
    );
  }
  return { status: "ready", value: { end, map, start } };
}

/**
 * Span-node access for the formatting owner behind the interaction-target
 * seam. Commit mechanics (accepted-deletion math, proposal-deletion
 * preparation, proposal mutation, caret restore) live in ReviewTargetEdit
 * behind $commitTargetEdit.
 */

/** Identity-axis classification behind the seam: kind only, no live nodes leak. */
export type ProposalKind =
  "insertion" | "deletion" | "replacement" | "formatting" | "fragment";

export function inspectProposalKind(
  proposalId: string,
): Preparation<ProposalKind> {
  return inspectCollectedProposalKind(
    collectProposalNodes(proposalId),
    proposalId,
  );
}

export function inspectCollectedProposalKind(
  collected: CollectedProposalNodes,
  proposalId: string,
): Preparation<ProposalKind> {
  const group = inspectCollectedProposalGroup(collected, proposalId);
  if (group.status !== "ready") return group;
  return { status: "ready", value: group.value.kind };
}

/**
 * Span-node access behind the seam. Owners read span nodes for format
 * computation or isolate them for editing, without walking offset maps.
 */

/** Overlapping span nodes without mutation; formats via node.getFormat(). */
export function getTargetSpanNodes(
  target: AcceptedRangeTarget | ProposalRangeTarget,
): TextNode[] {
  if (target.kind === "proposal-range") {
    const mapped = proposalMapOf(target, inspectProposalGroup);
    if (mapped.status !== "ready") return [];
    return overlappingSlices(
      mapped.value.entries,
      target.start,
      target.end,
    ).map((slice) => slice.node);
  }
  const map = buildAcceptedMap(target.paragraph);
  return overlappingSlices(map.entries, target.start, target.end).map(
    (slice) => slice.node,
  );
}

/** Split span edges and return the span's live text nodes. */
export function isolateTargetSpanNodes(
  target: AcceptedRangeTarget | ProposalRangeTarget,
): TextNode[] {
  const { start, end } = target;
  if (target.kind === "proposal-range") {
    const mapped = proposalMapOf(target, inspectProposalGroup);
    if (mapped.status !== "ready") return [];
    return isolateSpanNodes(mapped.value.entries, start, end);
  }
  return isolateSpanNodes(
    buildAcceptedMap(target.paragraph).entries,
    start,
    end,
  );
}

/** Fragment-local classification behind the seam: ownership plus offsets. */
export type FragmentSelection = {
  group: { wrappers: ReviewFragmentNode[]; paragraphs: ParagraphNode[] };
  selection: RangeSelection;
  start: number;
  end: number;
  backward: boolean;
};

export function fragmentAtPoint(point: PointType): ReviewFragmentNode | null {
  const node = point.getNode();
  return $isReviewFragmentNode(node)
    ? node
    : $isReviewFragmentNode(node.getParent())
      ? node.getParent<ReviewFragmentNode>()
      : null;
}

export function offsetInGroup(
  point: PointType,
  group: { wrappers: readonly ReviewFragmentNode[] },
): number | null {
  let base = 0;
  for (const wrapper of group.wrappers) {
    if (point.key === wrapper.getKey() && point.type === "element")
      return (
        base +
        wrapper
          .getChildren()
          .slice(0, point.offset)
          .reduce((n, child) => n + child.getTextContentSize(), 0)
      );
    for (const child of wrapper.getChildren()) {
      if (point.key === child.getKey() && point.type === "text")
        return base + point.offset;
      base += child.getTextContentSize();
    }
    base++;
  }
  return null;
}

/**
 * Fragment-owned selection behind the seam. Null means the selection does
 * not touch fragment content and the caller falls through to other claims.
 */
export function inspectFragmentSelection(): Preparation<FragmentSelection> | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = fragmentAtPoint(selection.anchor);
  const focus = fragmentAtPoint(selection.focus);
  if (!anchor && !focus) return null;
  if (!anchor || !focus || anchor.getProposalId() !== focus.getProposalId())
    return refusal(
      "unsafe-proposal-intersection",
      "A fragment edit must remain wholly within one proposal.",
    );
  const inspected = inspectSelection();
  if (inspected.status !== "ready") return inspected;
  const group = inspectFragmentGroup(anchor.getProposalId());
  if (group.status !== "ready") return group;
  const a = offsetInGroup(selection.anchor, group.value);
  const b = offsetInGroup(selection.focus, group.value);
  if (a === null || b === null)
    return refusal("unsupported-target", "Invalid fragment selection.");
  return {
    status: "ready",
    value: {
      group: group.value,
      selection,
      start: Math.min(a, b),
      end: Math.max(a, b),
      backward: selection.isBackward(),
    },
  };
}

export type StructuralPosition = Readonly<{
  paragraph: ParagraphNode;
  index: number;
  text: TextNode | null;
  offset: number;
}>;

/**
 * Structural caret classification behind the seam. Collapsed carets only:
 * proposal endpoints resolve to wrapper edges, accepted points to paragraph
 * indexes. Owners no longer pass a structural flag; that mode is internal.
 */
export function inspectStructuralPosition(): Preparation<StructuralPosition> {
  const inspection = inspectSelection(true);
  if (inspection.status !== "ready") return inspection;
  if (!inspection.value.collapsed)
    return refusal(
      "unsupported-target",
      "Structural editing requires a collapsed caret; Enter-over-range is unsupported.",
    );
  const point = inspection.value.anchor;
  if (point.association === "accepted" && !point.node) {
    const left = point.paragraph.getChildAtIndex(point.childIndex - 1);
    const right = point.paragraph.getChildAtIndex(point.childIndex);
    if (
      ($isReviewFragmentNode(right) && right.startsParagraph()) ||
      ($isReviewFragmentNode(left) &&
        isRootParagraph(point.paragraph.getNextSibling()) &&
        $isReviewFragmentNode(
          point.paragraph.getNextSibling<ParagraphNode>()!.getFirstChild(),
        ))
    )
      return refusal(
        "unsafe-proposal-intersection",
        "Structural editing cannot cross fragment-owned boundaries.",
      );
  }

  let index = point.childIndex;
  if (point.association === "proposal") {
    const group = inspectProposalGroup(point.wrapper.getProposalId());
    if (group.status !== "ready") return group;
    const children = point.wrapper.getChildren();
    const before =
      point.node === null
        ? point.offset === 0
        : point.node === children[0] && point.offset === 0;
    const after =
      point.node === null
        ? point.offset === point.wrapper.getTextContentSize()
        : point.node === children.at(-1) &&
          point.offset === point.node.getTextContentSize();
    if (before && point.wrapper === group.value.wrappers[0])
      index = point.wrapper.getIndexWithinParent();
    else if (after && point.wrapper === group.value.wrappers.at(-1))
      index = point.wrapper.getIndexWithinParent() + 1;
    else
      return refusal(
        "unsafe-proposal-intersection",
        "A structural change may not divide a pending text proposal.",
      );
    return {
      status: "ready",
      value: { paragraph: point.paragraph, index, text: null, offset: 0 },
    };
  }
  if (point.node && point.offset === point.node.getTextContentSize()) index++;
  // Element positions between the two sides of one replacement are not endpoints.
  const left = point.paragraph.getChildAtIndex(index - 1);
  const right = point.paragraph.getChildAtIndex(index);
  if (
    (!point.node ||
      point.offset === 0 ||
      point.offset === point.node.getTextContentSize()) &&
    isReviewElementNode(left) &&
    isReviewElementNode(right) &&
    left.getProposalId() === right.getProposalId()
  )
    return refusal(
      "unsafe-proposal-intersection",
      "A structural change may not divide a shared proposal identity.",
    );
  return {
    status: "ready",
    value: {
      paragraph: point.paragraph,
      index,
      text:
        point.node &&
        point.offset > 0 &&
        point.offset < point.node.getTextContentSize()
          ? point.node
          : null,
      offset: point.offset,
    },
  };
}
