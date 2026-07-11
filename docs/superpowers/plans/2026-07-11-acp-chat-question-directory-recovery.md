# ACP Chat Question Directory Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the clickable Question Directory for ACP Chat user messages.

**Architecture:** Derive directory entries directly from the active ACP timeline in `Chat`, rather than legacy Gateway messages. Give each rendered ACP user message a stable DOM anchor based on its timeline item id, then use the existing toolbar props and a local sidebar component to scroll to that anchor.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, react-i18next, Vitest with Testing Library, Electron Playwright.

---

## File Structure

- Modify: `src/pages/Chat/AcpTimeline.tsx`
  - Export the deterministic user-message anchor-id formatter and attach it to each rendered ACP user message wrapper.
- Modify: `src/pages/Chat/index.tsx`
  - Derive entries from `AcpTimelineSnapshot`, own the directory open state, render the sidebar, and pass the existing toolbar props.
- Modify: `tests/unit/chat-question-directory.test.tsx`
  - Replace the ACP-disabled regression expectation with interaction coverage for listing and smooth scrolling.
- Modify: `tests/e2e/chat-question-directory.spec.ts`
  - Verify the Electron ACP flow enables, opens, and navigates through the directory.
- Review only: `README.md`, `README.zh-CN.md`, `README.ja-JP.md`
  - Confirm no documentation change is required because this restores already-shipped chat navigation rather than adding a new workflow.

### Task 1: Write The Restored Directory Tests

**Files:**
- Modify: `tests/unit/chat-question-directory.test.tsx:1-243`
- Modify: `tests/e2e/chat-question-directory.spec.ts:130-192`

- [ ] **Step 1: Replace the disabled ACP unit assertion with directory and anchor interaction coverage.**

  Add `fireEvent` to the Testing Library import. In the existing two-question test, replace the disabled assertions with this behavior:

  ```tsx
  it('lists repeated ACP questions and smoothly scrolls to the selected user message', () => {
    acpState.timeline = timelineFromQuestions(['hello', 'hello']);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    const toggle = screen.getByTestId('chat-question-directory-toggle');
    expect(toggle).toBeEnabled();
    expect(screen.getAllByTestId('acp-user-message')).toHaveLength(2);
    expect(screen.getAllByText('hello')).toHaveLength(2);

    fireEvent.click(toggle);

    const directory = screen.getByTestId('chat-question-directory');
    expect(directory.querySelectorAll('button')).toHaveLength(2);
    expect(document.getElementById('acp-user-message-msg-user:0')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-question-directory-item-msg-user:0'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
  ```

  Keep the latest-question test, but change its final assertion to
  `expect(screen.getByTestId('chat-question-directory-toggle')).toBeEnabled()`.

- [ ] **Step 2: Change the Electron ACP test to exercise the restored navigation.**

  Rename the first test to describe opening a directory. After emitting
  `seededHistory`, replace its disabled assertions with:

  ```ts
  const toggle = page.getByTestId('chat-question-directory-toggle');
  await expect(toggle).toBeEnabled();
  await toggle.click();

  const directory = page.getByTestId('chat-question-directory');
  await expect(directory).toBeVisible();
  await expect(directory).toContainText('Question directory');
  await expect(directory.locator('button')).toHaveCount(4);
  await expect(directory).toContainText('First question: summarize the market opening.');
  await expect(directory).toContainText('Fourth question: prepare the final action plan.');

  await page.getByTestId('chat-question-directory-item-question-directory-0:0').click();
  await expect(page.locator('[id="acp-user-message-question-directory-0:0"]')).toBeInViewport();
  ```

  In the second Electron test, replace the disabled toolbar assertion with the
  following interaction. This keeps the historical replay coverage for long
  ACP timelines:

  ```ts
  const toggle = page.getByTestId('chat-question-directory-toggle');
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.getByTestId('chat-question-directory')).toContainText(latestQuestion);
  ```

- [ ] **Step 3: Run the focused tests to verify the regression is exposed.**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/chat-question-directory.test.tsx
  ```

  Expected: FAIL because `Chat` still supplies no directory items or toggle
  callback, so the toolbar button is disabled and the directory is absent.

  Run:

  ```bash
  pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-question-directory.spec.ts
  ```

  Expected: FAIL because the ACP toolbar button remains disabled.

### Task 2: Derive ACP Entries And Attach User Anchors

**Files:**
- Modify: `src/pages/Chat/AcpTimeline.tsx:1-46`
- Modify: `src/pages/Chat/index.tsx:6-448`
- Test: `tests/unit/chat-question-directory.test.tsx`
- Test: `tests/e2e/chat-question-directory.spec.ts`

- [ ] **Step 1: Add a shared ACP user-message anchor formatter.**

  In `src/pages/Chat/AcpTimeline.tsx`, export the formatter immediately after
  the imports and apply it to the wrapper already rendered for each user item:

  ```tsx
  export function getAcpUserMessageAnchorId(itemId: string): string {
    return `acp-user-message-${itemId}`;
  }

  // Inside the group.kind === 'user' branch:
  <div
    key={item.id}
    id={getAcpUserMessageAnchorId(item.id)}
    data-acp-item-id={item.id}
  >
    <AcpMessageSegment item={item} />
  </div>
  ```

  Keep assistant timeline markup unchanged. Timeline ids are unique within an
  ACP snapshot, so this creates one stable target per user message segment.

- [ ] **Step 2: Add directory item derivation and local open state in `Chat`.**

  Import `MessageSegmentItem` from `@/lib/acp/timeline-types` and
  `getAcpUserMessageAnchorId` from `./AcpTimeline`. Near the file constants,
  add the item type, render cap, and title helper:

  ```tsx
  type QuestionDirectoryItem = {
    itemId: string;
    anchorId: string;
    title: string;
  };

  const QUESTION_DIRECTORY_RENDER_LIMIT = 300;

  function buildQuestionDirectoryTitle(item: MessageSegmentItem, fallback: string): string {
    const markdown = item.parts.find(
      (part): part is Extract<RenderPart, { kind: 'markdown' }> => part.kind === 'markdown' && part.text.trim().length > 0,
    );
    const normalized = markdown?.text.replace(/\s+/g, ' ').trim();
    if (!normalized) return fallback;
    return normalized.length > 64 ? `${normalized.slice(0, 64)}...` : normalized;
  }
  ```

  In `Chat`, add session-keyed open state and derive entries from
  `acpTimeline.itemOrder`, filtering strictly to `message-segment` items whose
  `role` is `user`:

  ```tsx
  const [questionDirectoryOpenSessionKey, setQuestionDirectoryOpenSessionKey] = useState<string | null>(null);

  const questionDirectoryItems = useMemo<QuestionDirectoryItem[]>(() => {
    let ordinal = 0;
    return acpTimeline.itemOrder.flatMap((itemId) => {
      const item = acpTimeline.itemsById[itemId];
      if (!item || item.kind !== 'message-segment' || item.role !== 'user') return [];
      ordinal += 1;
      return [{
        itemId: item.id,
        anchorId: getAcpUserMessageAnchorId(item.id),
        title: buildQuestionDirectoryTitle(item, t('questionDirectory.fallback', { number: ordinal })),
      }];
    });
  }, [acpTimeline, t]);

  const questionDirectoryVisible = questionDirectoryOpenSessionKey === currentSessionKey
    && questionDirectoryItems.length > 1;
  ```

  Pass `questionDirectoryVisible`, `questionDirectoryItems.length`, and a
  callback that toggles `questionDirectoryOpenSessionKey` between
  `currentSessionKey` and `null` to `ChatToolbar`. This preserves the existing
  rule that fewer than two questions leaves the button disabled.

- [ ] **Step 3: Render the existing-style Question Directory sidebar.**

  Add this local component to `src/pages/Chat/index.tsx`, before
  `AcpEmptyState`, and render it as a sibling of the scrollable chat column
  inside the `lg:flex-row` container when `questionDirectoryVisible` is true:

  ```tsx
  function QuestionDirectory({ items }: { items: QuestionDirectoryItem[] }) {
    const { t } = useTranslation('chat');
    const scrollRef = useRef<HTMLElement | null>(null);
    const visibleItems = items.slice(0, QUESTION_DIRECTORY_RENDER_LIMIT);
    const hiddenCount = Math.max(0, items.length - visibleItems.length);

    useEffect(() => {
      const scrollElement = scrollRef.current;
      if (scrollElement) scrollElement.scrollTop = scrollElement.scrollHeight;
    }, [visibleItems.length]);

    return (
      <aside data-testid="chat-question-directory" className="w-full shrink-0 lg:w-64 xl:w-72" aria-label={t('questionDirectory.title')}>
        <div className="sticky top-2 max-h-full overflow-hidden rounded-2xl border border-black/5 bg-surface-input p-3 shadow-sm dark:border-white/10">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('questionDirectory.title')}</h2>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/10">{items.length}</span>
          </div>
          <nav ref={scrollRef} className="max-h-[calc(100vh-13rem)] space-y-1 overflow-y-auto pr-1">
            {visibleItems.map((item) => (
              <button
                key={item.itemId}
                type="button"
                data-testid={`chat-question-directory-item-${item.itemId}`}
                onClick={() => document.getElementById(item.anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={cn('group flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors', 'text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10')}
                title={item.title}
              >
                <span className="line-clamp-2 min-w-0 text-xs leading-5">{item.title}</span>
              </button>
            ))}
            {hiddenCount > 0 && <div className="px-2 py-2 text-xs leading-5 text-muted-foreground">{t('questionDirectory.moreHint', { count: hiddenCount })}</div>}
          </nav>
        </div>
      </aside>
    );
  }
  ```

  The optional chaining makes a stale or missing anchor a no-op. It does not
  modify the existing sticky-to-bottom hook or ACP timeline reducer.

- [ ] **Step 4: Run the focused unit and Electron tests to verify the implementation.**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/chat-question-directory.test.tsx
  ```

  Expected: PASS, including duplicate entries and `scrollIntoView` with smooth
  behavior targeting the ACP user anchor.

  Run:

  ```bash
  pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-question-directory.spec.ts
  ```

  Expected: PASS, including opening the directory from replayed ACP history
  and scrolling the selected user anchor into the Electron viewport.

- [ ] **Step 5: Commit the restored feature and coverage.**

  ```bash
  git add src/pages/Chat/AcpTimeline.tsx src/pages/Chat/index.tsx tests/unit/chat-question-directory.test.tsx tests/e2e/chat-question-directory.spec.ts
  git commit -m "fix(chat): restore ACP question directory"
  ```

### Task 3: Run Broader Validation And Documentation Review

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`

- [ ] **Step 1: Run related ACP component coverage.**

  ```bash
  pnpm exec vitest run tests/unit/chat-question-directory.test.tsx tests/unit/acp-chat-components.test.tsx tests/unit/chat-acp-page.test.tsx
  ```

  Expected: PASS. This confirms the added user anchors preserve ACP timeline
  ordering and that the Chat page keeps its existing ACP loading behavior.

- [ ] **Step 2: Run static validation.**

  ```bash
  pnpm run typecheck
  pnpm run lint:check
  ```

  Expected: both commands exit with status 0.

- [ ] **Step 3: Re-run the targeted Electron E2E test from a fresh Vite build.**

  ```bash
  pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-question-directory.spec.ts
  ```

  Expected: PASS.

- [ ] **Step 4: Review user documentation and the final worktree.**

  Read `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. Do not edit them
  unless they explicitly document the Question Directory as unavailable in ACP
  Chat; this change restores existing behavior and introduces no new workflow.

  ```bash
  git diff --check
  git status --short
  ```

  Expected: no whitespace errors and only the intended feature commit in the
  worktree history.
