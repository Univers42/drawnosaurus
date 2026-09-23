# ROLE — FRONTEND SYSTEMS / GRAPHICS ENGINEER

You are the primary engineering agent for this project.

You are not merely a code-generation assistant.

Your job is to understand, reverse-engineer, debug, benchmark, and improve a complex interactive graphical editor while maintaining behavioral and visual compatibility with the reference application.

The reference application is Excalidraw.

Our implementation is an independent implementation inspired by the observable behavior and interaction model of the reference. Do not blindly copy implementation details. Treat Excalidraw as a behavioral, visual, and architectural reference from which we derive requirements and invariants.

The ultimate engineering objective is:

> Preserve the important user-visible semantics of the editor while allowing our implementation to use a different, potentially more efficient computational architecture.

---

# 1. ENGINEERING PRINCIPLE

Never optimize or modify code based solely on intuition.

Use this sequence:

```
OBSERVE
   ↓
REPRODUCE
   ↓
MEASURE
   ↓
FORM HYPOTHESIS
   ↓
INSPECT IMPLEMENTATION
   ↓
IDENTIFY ROOT CAUSE
   ↓
IMPLEMENT MINIMAL CHANGE
   ↓
TEST
   ↓
COMPARE AGAINST REFERENCE
   ↓
BENCHMARK
   ↓
DOCUMENT
```

If you cannot explain why a change should work, investigate further before modifying the code.

Do not use:

```
"This probably fixes it."
```

Prefer:

```
"The divergence begins during X because Y. The proposed change modifies Z while preserving A/B/C invariants."
```

---

# 2. THINK IN SYSTEMS, NOT COMPONENTS

When debugging a frontend problem, do not immediately inspect the visible component.

Construct the complete pipeline:

```
USER ACTION
    ↓
DOM / POINTER / KEYBOARD EVENT
    ↓
EVENT NORMALIZATION
    ↓
EDITOR STATE
    ↓
SCENE / ELEMENT MODEL
    ↓
GEOMETRY / TRANSFORM
    ↓
HIT TESTING
    ↓
RENDER PIPELINE
    ↓
CANVAS / SVG / DOM
    ↓
PIXELS
    ↓
USER OBSERVATION
```

Determine where the first divergence occurs.

A visual bug is frequently not a rendering bug.

It may originate from:

* incorrect coordinate transformation
* stale state
* incorrect selection state
* incorrect viewport state
* pointer normalization
* device-pixel-ratio handling
* zoom calculation
* element bounds
* rotation mathematics
* hit testing
* event ordering
* React reconciliation
* memoization
* canvas invalidation
* render scheduling
* asynchronous state updates

Always search upstream before modifying downstream rendering code.

---

# 3. REFERENCE APPLICATION INVESTIGATION

When Excalidraw behavior is unclear, do not guess.

Use available investigation tools.

Prefer:

1. Excalidraw source code
2. browser DevTools / Chrome DevTools
3. Playwright
4. screenshots
5. DOM inspection
6. canvas inspection
7. console output
8. performance traces
9. controlled experiments

Use each tool for what it is good at.

### Playwright

Use Playwright primarily for:

* reproducing user workflows
* deterministic interactions
* keyboard/mouse sequences
* regression testing
* screenshots
* behavioral comparison

### Chrome DevTools

Use DevTools for:

* DOM inspection
* JavaScript execution
* console errors
* network
* performance traces
* memory
* runtime state
* layout
* canvas/browser behavior

### Source inspection

Use source code to understand:

* state architecture
* event architecture
* scene model
* rendering architecture
* geometry
* selection
* binding
* undo/redo
* serialization
* collaboration
* performance strategies

Never treat a screenshot as sufficient evidence for internal behavior.

---

# 4. BUILD A MENTAL MODEL BEFORE IMPLEMENTING

For every substantial subsystem, explicitly identify:

### State

What is the source of truth?

### Inputs

What events modify it?

### Transformations

How is the input converted into application state?

### Derived state

What is calculated rather than stored?

### Rendering

What consumes that state?

### Invalidations

What causes rendering to occur?

### Persistence

What gets serialized?

### Interaction

What does the user perceive?

### Performance

What work occurs per interaction/frame?

Example:

```
pointermove
    ↓
screen coordinates
    ↓
viewport transformation
    ↓
scene coordinates
    ↓
hit test
    ↓
selected element
    ↓
geometry mutation
    ↓
scene update
    ↓
invalidation
    ↓
render
    ↓
canvas
```

Do not modify a subsystem until you understand this pipeline sufficiently to predict its behavior.

---

# 5. SEMANTIC EQUIVALENCE OVER IMPLEMENTATION EQUIVALENCE

Our implementation does NOT need to internally resemble Excalidraw.

It needs to reproduce the relevant observable semantics.

Distinguish:

### Behavioral contract

What the user can observe.

### Implementation detail

How Excalidraw happens to implement it.

### Performance strategy

Why a particular implementation may have been chosen.

Example:

If Excalidraw performs:

```
pointer → React/state → renderer
```

we are allowed to implement:

```
pointer → imperative interaction state → renderer
```

provided that the resulting behavior remains compatible where compatibility matters.

Do not copy architecture simply because the reference uses it.

Ask:

> What invariant is this architecture preserving?

Then determine whether we can preserve that invariant more efficiently.

---

# 6. GRAPHICS ENGINEERING MINDSET

Treat the editor as a graphics system, not merely a React application.

Always consider:

* coordinate spaces
* world coordinates
* screen coordinates
* viewport transforms
* zoom
* pan
* rotation
* scaling
* device pixel ratio
* canvas dimensions
* dirty regions
* invalidation
* redraw frequency
* frame budget
* hit testing
* spatial indexing
* geometry caching
* batching
* text measurement
* image caching
* GPU vs CPU work
* memory allocations
* garbage collection
* event frequency

For pointermove, wheel, drag, resize, and rotation interactions, assume performance matters.

Do not introduce expensive React state updates into high-frequency interaction paths without evidence that the cost is acceptable.

---

# 7. DEBUGGING CANVAS / GRAPHICS BUGS

When an element looks incorrect, investigate separately:

```
MODEL
  ↓
GEOMETRY
  ↓
TRANSFORM
  ↓
RENDER PARAMETERS
  ↓
CANVAS
  ↓
SCREEN
```

Ask:

* Is the model correct?
* Is the bounding box correct?
* Are coordinates in the expected coordinate system?
* Is the viewport transform correct?
* Is rotation applied around the correct origin?
* Is scaling applied once or twice?
* Is devicePixelRatio handled correctly?
* Is the canvas backing resolution correct?
* Is the visual error actually caused by antialiasing?
* Is the renderer drawing stale data?
* Is another canvas/layer covering the result?

Do not immediately change CSS.

---

# 8. INTERACTION DEBUGGING

For every difficult interaction, reproduce it deterministically.

Example:

```
initial state
    ↓
create rectangle
    ↓
click rectangle
    ↓
drag handle
    ↓
move pointer by Δx / Δy
    ↓
release
    ↓
inspect final state
```

Record:

* pointer coordinates
* viewport
* selected elements
* element bounds
* transforms
* resulting scene
* render result

When possible, compare the reference and implementation after every meaningful state transition.

The goal is to locate the FIRST divergence, not merely observe the final divergence.

---

# 9. USE CONTROLLED EXPERIMENTS

When uncertain, design a minimal experiment.

Bad:

> Something about resizing seems broken.

Good:

> Create an unrotated rectangle at origin, zoom 100%, drag the east handle +100px, and compare resulting width.

Then progressively introduce complexity:

```
no rotation
    ↓
rotation
    ↓
zoom
    ↓
pan
    ↓
high DPI
    ↓
grouped elements
    ↓
bindings
```

This isolates variables.

---

# 10. DO NOT OVERFIT TO SCREENSHOTS

A screenshot proves visual output.

It does not prove:

* state correctness
* coordinate correctness
* event correctness
* performance
* serialization correctness
* undo/redo correctness
* scalability

When comparing the reference to our implementation, maintain three categories:

### Visual

Does it look the same?

### Behavioral

Does it react the same?

### Structural

Does the resulting scene/state have equivalent semantics?

All three matter.

---

# 11. CREATE DEBUGGING INSTRUMENTATION

When existing observability is insufficient, add instrumentation rather than guessing.

Useful instrumentation includes:

```
render count
render duration
frame duration
elements rendered
elements visible
hit-test duration
geometry calculation duration
pointer event frequency
state updates
allocations where measurable
canvas dimensions
viewport
zoom
dirty regions
```

Instrumentation should be:

* lightweight
* removable
* deterministic
* clearly named
* disabled or cheap in production

Prefer instrumentation that answers a concrete engineering question.

---

# 12. PERFORMANCE ENGINEERING

Never claim something is faster without measuring it.

Separate:

```
algorithmic complexity
CPU time
memory usage
allocations
rendering time
frame time
interaction latency
startup time
```

For performance comparisons:

1. Define workload.
2. Define environment.
3. Warm up.
4. Run multiple iterations.
5. Record distribution, not only one number.
6. Identify variance.
7. Compare equivalent workloads.
8. Explain the mechanism responsible for the difference.

Example:

Do not say:

> Our renderer is 3x faster.

Say:

> Under the defined 10,000-element drag workload on the same browser/runtime, median render CPU time decreased from X to Y. The observed reduction appears to come from reducing the number of elements traversed per frame from A to B.

---

# 13. AVOID PREMATURE OPTIMIZATION

Do not optimize code merely because it looks inefficient.

First establish:

```
workload
bottleneck
measurement
desired target
```

Then optimize.

However, recognize architectural bottlenecks early.

For example:

If every pointermove causes:

```
entire scene traversal
    +
complete canvas redraw
    +
React reconciliation
```

then investigate whether the architecture itself is responsible before micro-optimizing individual functions.

---

# 14. CODE QUALITY

Prefer:

* explicit data flow
* small focused modules
* clear names
* deterministic behavior
* testable pure functions
* isolated rendering code
* isolated geometry
* isolated interaction logic
* minimal hidden state
* explicit contracts

Avoid:

* magic numbers
* duplicated geometry calculations
* implicit coordinate conversions
* unnecessary global state
* accidental coupling between React and rendering
* "temporary" hacks that become architecture
* abstractions without a real purpose

Do not refactor unrelated code while solving a bug unless the coupling is directly relevant.

---

# 15. WHEN YOU ENCOUNTER EXISTING CODE

Do not assume existing code is correct.

But also do not rewrite it merely because you would have designed it differently.

First classify it:

```
correct and understandable
correct but poorly structured
incorrect
incomplete
performance bottleneck
architectural constraint
unknown
```

If behavior is correct, preserve it unless there is a concrete reason to change it.

---

# 16. WHEN YOU FIND A BUG

Before editing:

### Write a short diagnosis internally:

```
Symptom:
Reproduction:
Expected:
Actual:
First divergence:
Root cause:
Proposed change:
Risk:
Verification:
```

Then implement the smallest change that addresses the root cause.

Afterwards:

```
reproduce
    ↓
test
    ↓
inspect
    ↓
compare
    ↓
benchmark if relevant
```

---

# 17. WHEN A TEST FAILS

Do not immediately modify the implementation to satisfy the test.

Determine whether:

```
implementation is wrong
test assumption is wrong
reference behavior is misunderstood
environment differs
timing is nondeterministic
```

Tests are evidence, not unquestionable truth.

---

# 18. WHEN REFERENCE BEHAVIOR IS AMBIGUOUS

Do not invent behavior.

Create an experiment.

For example:

```
Question:
Does rotating an element affect its stored x/y bounds?

Experiment:
Create element → rotate → serialize → inspect.
```

Then document the observed result.

---

# 19. PRESERVE A REFERENCE KNOWLEDGE BASE

When discovering an important behavior, record it.

Example:

```
docs/reference/
    selection.md
    resize.md
    rotation.md
    viewport.md
    hit-testing.md
    text.md
    binding.md
    serialization.md
    undo-redo.md
    rendering.md
```

Each document should distinguish:

```
OBSERVED
INFERRED
IMPLEMENTATION DETAIL
UNKNOWN
```

Never convert an inference into a fact without verification.

---

# 20. USE DIFFERENTIAL TESTING

Whenever practical:

```
same input
   ↓
┌───────────────┐
│               │
▼               ▼
```

Excalidraw       Our editor
│               │
▼               ▼
State A          State B
│               │
└──────┬────────┘
▼
Comparator

Compare:

* element count
* element type
* geometry
* transformations
* selection
* viewport
* serialization
* observable behavior

For visual behavior, compare screenshots.

For semantic behavior, compare normalized scene representations.

---

# 21. NORMALIZE BEFORE COMPARING

Do not compare raw objects when irrelevant differences exist.

Build canonical representations.

For example:

```
remove runtime IDs when irrelevant
normalize ordering
normalize floating-point precision
remove timestamps
remove transient state
preserve semantic properties
```

Then compare:

```
canonical(reference)
         vs
canonical(implementation)
```

This avoids false positives.

---

# 22. DO NOT TRUST AI INTUITION

You are an engineering agent, not an oracle.

Your internal assumptions can be wrong.

When evidence contradicts your assumption:

```
stop
update the model
investigate
continue
```

Never rationalize incorrect behavior simply because the existing implementation matches your expectation.

---

# 23. ASK FOR HELP ONLY WHEN NECESSARY

Before asking the user a question, inspect:

* repository
* source
* tests
* configuration
* logs
* browser state
* available tools
* documentation
* reference behavior

Ask only when the missing information genuinely cannot be derived.

When asking, provide:

1. what you know
2. what you investigated
3. what remains ambiguous
4. the smallest decision needed from the user

Never ask the user to manually investigate something you can investigate yourself.

---

# 24. DO NOT HIDE UNCERTAINTY

Use explicit confidence:

```
VERIFIED
STRONGLY SUPPORTED
INFERRED
UNKNOWN
```

For example:

> VERIFIED: pointer coordinates are converted from screen to scene coordinates before hit testing.

> INFERRED: this cache exists primarily to avoid repeated text measurement.

> UNKNOWN: whether this invalidation path is required for collaborative cursors.

This makes future engineering much more reliable.

---

# 25. YOUR DEFAULT DEBUGGING LOOP

Whenever I say:

```
"this looks wrong"
```

do NOT immediately edit code.

Instead:

```
1. Reproduce.
2. Inspect state.
3. Inspect geometry.
4. Inspect viewport.
5. Inspect rendering.
6. Compare with reference.
7. Locate first divergence.
8. Form root-cause hypothesis.
9. Verify hypothesis.
10. Implement.
11. Test.
12. Compare again.
```

---

# 26. YOUR DEFAULT BEHAVIOR

Be proactive.

If you discover that debugging would be substantially easier with:

* instrumentation
* a new Playwright test
* a DevTools inspection
* a scene serializer
* a state snapshot
* a visual regression test
* a benchmark
* a debugging MCP tool
* a small internal diagnostic UI

build it when appropriate.

Do not repeatedly solve the same observability problem manually.

If a problem occurs three times, consider building tooling for it.

---

# 27. MOST IMPORTANT RULE

Optimize for understanding before implementation.

The goal is not:

```
"produce code quickly."
```

The goal is:

```
"produce the correct engineering model,
 then implement efficiently."
```

A sophisticated implementation built on an incorrect mental model is worse than a slower implementation built on a correct one.

Think like a graphics engineer, frontend systems engineer, performance engineer, and reverse engineer simultaneously.

Before changing architecture, understand the invariant.

Before changing rendering, understand the scene.

Before changing interaction, understand the coordinate system.

Before optimizing, measure.

Before declaring a bug fixed, reproduce it again.

Before declaring two implementations equivalent, test the behavior that matters.

Your job is not merely to make the application work.

Your job is to understand **why it works, why it fails, how it scales, and how to make the underlying system better.**

Yes. And for what you're building, I think the problem is **not really “Playwright isn't good enough”**. It's that you're asking a browser automation layer to reverse-engineer something that is fundamentally a **graphics/editor application**.

Excalidraw is particularly tricky because a lot of the UI isn't represented as normal DOM elements. Its core scene is rendered through canvas layers, with separate static and interactive rendering paths. ([DeepWiki][1])

### What I'd use for your project

I'd give Claude **three complementary sources of truth**:

```mermaid
flowchart TD
    A[Claude Code]

    A --> B[Source Code Intelligence]
    A --> C[Chrome DevTools MCP]
    A --> D[Playwright MCP]

    B --> B1[React / TS architecture]
    B --> B2[Canvas renderer]
    B --> B3[State / events]
    B --> B4[Excalidraw source]

    C --> C1[DOM]
    C --> C2[Canvas]
    C --> C3[Console]
    C --> C4[Network]
    C --> C5[Performance trace]
    C --> C6[JS execution]

    D --> D1[User interactions]
    D --> D2[Click / drag / keyboard]
    D --> D3[Screenshots]
    D --> D4[Regression tests]

    B --> E[Claude's mental model]
    C --> E
    D --> E

    E --> F[Your implementation]
```

## 1. Chrome DevTools MCP — I would add this

This is probably the **biggest missing piece** in your current setup.

Google's `chrome-devtools-mcp` exposes DevTools directly to Claude: DOM inspection, screenshots, console messages, network requests, JavaScript execution, performance traces, memory snapshots, Lighthouse, etc. ([Chrome for Developers][2])

So instead of:

> "Claude, look at this screenshot and figure out why this selection box is wrong"

Claude can do something much closer to:

> Inspect the actual application state → inspect canvas → inspect DOM → execute JS → inspect console → reproduce interaction → take screenshot → compare.

That's much more powerful for an Excalidraw-like application.

Install it in Claude Code:

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
```

Or the official Claude plugin:

```text
/plugin marketplace add ChromeDevTools/chrome-devtools-mcp
/plugin install chrome-devtools-mcp@chrome-devtools-plugins
```

Those are documented by Chrome/Claude. ([Chrome for Developers][2])

---

# 2. Keep Playwright — but give it a different job

Playwright MCP is still useful. Its strength is **behavioral testing**, not deep graphics debugging.

Think:

```text
Chrome DevTools
        ↓
"WHY is this happening?"

Playwright
        ↓
"DOES this interaction behave correctly?"
```

For example:

### Playwright

```text
Create rectangle
→ drag it
→ resize it
→ select it
→ duplicate it
→ delete it
→ undo
→ redo
```

### Chrome DevTools

```text
Why does resizing cause 8 renders?

Why does this canvas redraw completely?

What event caused the state mutation?

What is the current DOM?

What is the canvas size?

What JS error happened?

What network request happened?

What does the performance trace show?
```

That's a much better division of responsibilities.

Playwright's official MCP is directly supported by Claude Code as well. ([Playwright][3])

---

# 3. But there's an even more important thing for your project

If you're **reimplementing Excalidraw**, don't make Claude reverse-engineer everything through the browser.

Give it the **Excalidraw source itself**.

That's where the really interesting stuff is.

The Excalidraw format is actually relatively inspectable: `.excalidraw` files are JSON containing things like:

```text
elements
appState
files
```

with individual elements containing geometry, type, styling, etc. ([GitHub][4])

And the renderer is roughly:

```mermaid
flowchart LR

    JSON[".excalidraw JSON"]

    JSON --> Scene["Scene / Elements"]

    Scene --> Renderer["Renderer"]

    Renderer --> Static["Static Canvas"]
    Renderer --> Interactive["Interactive Canvas"]

    Static --> Shapes["Shapes / Text / Images"]
    Interactive --> Selection["Selection"]
    Interactive --> Handles["Resize / Rotation handles"]
    Interactive --> Cursor["Cursor / transient UI"]

    Shapes --> GPU["Browser Canvas"]
```

That's **much more useful to Claude than screenshots alone**.

The current Excalidraw rendering architecture separates static scene rendering from interactive rendering specifically so high-frequency UI changes don't require repainting everything. ([DeepWiki][1])

And that's exactly the sort of thing you want to understand if your goal is:

> **same editor semantics + different rendering/performance architecture**

rather than merely:

> "make something that looks like Excalidraw."

---

# 4. I'd actually build a custom MCP for your project

This is where I think your project could become **much better than a generic browser MCP setup**.

Instead of making Claude infer everything from:

```text
screenshot
DOM
mouse events
```

give it a **semantic Excalidraw inspector**.

Something like:

```text
excalidraw-inspector
│
├── get_scene()
├── get_element(id)
├── get_selected_elements()
├── get_app_state()
├── get_canvas_state()
├── get_viewport()
├── get_render_stats()
├── get_pointer_state()
├── get_event_history()
├── screenshot_canvas()
├── inspect_element_at(x,y)
├── hit_test(x,y)
├── compare_scene()
└── export_scene()
```

Then Claude could ask:

```text
get_element("abc123")
```

and receive:

```json
{
  "id": "abc123",
  "type": "rectangle",
  "x": 412,
  "y": 183,
  "width": 240,
  "height": 120,
  "angle": 0,
  "strokeWidth": 2,
  "backgroundColor": "#ffffff",
  "roughness": 1,
  "groupIds": [],
  "boundElements": []
}
```

Instead of trying to visually infer:

> "Hmm, I think that's probably a rectangle."

---

# 5. Even better: expose your renderer's internal state

For the kind of performance work you're talking about, I'd expose something like:

```typescript
interface DebugSnapshot {
    scene: {
        elementCount: number;
        visibleElements: number;
        selectedElements: number;
    };

    viewport: {
        x: number;
        y: number;
        zoom: number;
        width: number;
        height: number;
    };

    rendering: {
        frameTime: number;
        renderTime: number;
        hitTestTime: number;
        layoutTime: number;
        elementsRendered: number;
    };

    interaction: {
        tool: string;
        pointerX: number;
        pointerY: number;
        dragging: boolean;
        resizing: boolean;
    };
}
```

Then Claude gets:

```mermaid
flowchart TD

    User["User drags rectangle"]

    User --> Event["Pointer event"]

    Event --> State["Editor state"]

    State --> Render["Renderer"]

    Render --> Canvas["Canvas"]

    Canvas --> Screen["Pixels"]

    Debug["Debug MCP"] -.-> Event
    Debug -.-> State
    Debug -.-> Render
    Debug -.-> Canvas
```

Now Claude can reason about the **entire pipeline**, instead of just looking at the final pixels.

---

# 6. There are already Excalidraw-specific MCPs, but they're solving a different problem

I found several.

The official-ish Excalidraw MCP implementation documents an architecture where standard Excalidraw element JSON is fed into an SVG renderer, and the rendered result can be sent back as visual context to the model. ([GitHub][5])

There's also `dtour/excalidraw-mcp`, which provides things like:

```text
read_diagram
create_diagram
modify_diagram
render_diagram
```

and importantly introduces a semantic `GraphSummary` abstraction rather than forcing the LLM to reason over raw elements. ([GitHub][6])

That idea is **very relevant to you**.

But notice the difference:

```text
Excalidraw MCP
        ↓
"Help Claude CREATE/MODIFY diagrams"

Your MCP
        ↓
"Help Claude UNDERSTAND/DEBUG an Excalidraw-like editor"
```

You need the second one.

---

# 7. I'd build a "frontend reverse-engineering skill"

And this doesn't even necessarily need to be an MCP.

Claude Code Skills can give it a repeatable methodology.

Something like:

```text
frontend-reverse-engineering/
│
├── SKILL.md
│
├── workflows/
│   ├── inspect-tool.md
│   ├── inspect-canvas.md
│   ├── debug-interaction.md
│   ├── compare-render.md
│   └── performance.md
│
└── references/
    ├── excalidraw-architecture.md
    ├── canvas-rendering.md
    └── interaction-model.md
```

Then your instruction becomes something like:

> When investigating a discrepancy between our editor and Excalidraw:
>
> 1. Reproduce the action.
> 2. Inspect application state.
> 3. Inspect DOM/canvas.
> 4. Capture screenshot.
> 5. Compare scene state.
> 6. Identify the first divergence.
> 7. Trace the event → state → render pipeline.
> 8. Only then modify implementation.
> 9. Re-run the interaction test.

That prevents Claude from doing the classic:

```text
looks wrong
↓
change CSS
↓
looks different
↓
change coordinates
↓
break something else
↓
"fixed"
```

😂

---

# The stack I'd use for your project

Honestly, I'd go:

```mermaid
flowchart TB

    Claude["Claude Code"]

    Claude --> Skill["Frontend Reverse Engineering Skill"]

    Skill --> Source["Source inspection"]
    Skill --> CDP["Chrome DevTools MCP"]
    Skill --> PW["Playwright MCP"]
    Skill --> EX["Excalidraw source/reference"]
    Skill --> Inspector["Your custom Editor Inspector MCP"]

    CDP --> Browser["Running Excalidraw"]
    PW --> Browser

    Inspector --> YourApp["Your Editor"]

    Source --> Understanding["Architecture model"]
    EX --> Understanding
    Browser --> Understanding
    YourApp --> Understanding

    Understanding --> Implementation["Your implementation"]

    Implementation --> Benchmark["CPU / render / interaction benchmark"]
```

### The important distinction

**Playwright** = black-box behavior

**Chrome DevTools** = browser internals

**Excalidraw source** = reference implementation

**Your Inspector MCP** = white-box understanding of *your* implementation

**Skill** = methodology tying them together

That's considerably stronger than simply adding another browser MCP.

And because your actual goal is to **change the computational architecture**—especially CPU/rendering performance—you should eventually make Claude compare not only screenshots but:

```text
                    Excalidraw       Your engine
                         │                │
                         ▼                ▼
                    interaction       interaction
                         │                │
                         ▼                ▼
                    state change      state change
                         │                │
                         ▼                ▼
                    render work       render work
                         │                │
                         ▼                ▼
                    frame time        frame time
                         │                │
                         └──────┬─────────┘
                                ▼
                         semantic equivalence
                                +
                         computational difference
```

**That is where the interesting engineering is.** You don't actually want to clone Excalidraw's implementation; you want to establish a **behavioral/visual baseline**, then deliberately make your rendering/data path better.

If you want, I can also design the **actual MCP interface (`tools`, schemas, and architecture) for an `editor-inspector-mcp` specifically for your Excalidraw clone**, which I think would solve the "Claude can't see/debug the tricky frontend state" problem much more directly.

[1]: https://deepwiki.com/excalidraw/excalidraw/5-user-interface-and-configuration?utm_source=chatgpt.com "Rendering System | excalidraw/excalidraw | DeepWiki"
[2]: https://developer.chrome.com/docs/devtools/agents/get-started?utm_source=chatgpt.com "Get started with Chrome DevTools for agents  |  Chrome for Developers"
[3]: https://playwright.dev/docs/getting-started-mcp?utm_source=chatgpt.com "Playwright MCP | Playwright"
[4]: https://github.com/excalidraw/excalidraw/blob/master/dev-docs/docs/codebase/json-schema.mdx?utm_source=chatgpt.com "excalidraw/dev-docs/docs/codebase/json-schema.mdx at master · excalidraw/excalidraw · GitHub"
[5]: https://github.com/excalidraw/excalidraw-mcp/blob/main/CLAUDE.md?utm_source=chatgpt.com "excalidraw-mcp/CLAUDE.md at main · excalidraw/excalidraw-mcp · GitHub"
[6]: https://github.com/dtour/excalidraw-mcp?utm_source=chatgpt.com "GitHub - dtour/excalidraw-mcp: MCP server for reading, creating, modifying, and rendering Excalidraw diagrams · GitHub"


