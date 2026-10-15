# Copilot prompt: generate an HTML deck that imports cleanly into Proposal Studio

Paste the prompt below into Copilot (VS Code chat), then add your proposal brief under it. The HTML it writes can be
imported with **More menu -> Import deck (.html)**. Everything stays editable as native PowerPoint objects afterwards.

The importer reads the HTML as static text: scripts are never run and external links are never fetched, so keep
all content inline in the file.

---

## Prompt

Create a single self-contained HTML file for a solution proposal presentation. Follow this contract exactly so the
file can be imported into a PowerPoint generator:

1. Every slide is one `<section class="slide">` element. Do not nest slides.
2. Each slide has exactly one heading (`<h2>`, or `<h1>` on the first slide) with a short label of at most 6 words.
3. Put a `data-type` attribute on a slide when it is one of these (otherwise omit it):
   - `title`: first slide. `<h1>` plus one `<p class="subtitle">`.
   - `assumptions`: an `<ol>` or `<ul>`, one assumption per `<li>`, one sentence each.
   - `scope`: `<h3>In scope</h3><ul>...</ul><h3>Out of scope</h3><ul>...</ul>`.
   - `risks`: a `<table>` with header cells `Risk`, `Impact` (High, Medium or Low) and `Mitigation`.
   - `next_steps`: a `<table>` with header cells `Action`, `Owner`, `Due`.
   - `gantt`: a `<table>`; first header cell `Activity`, then `Week 1`, `Week 2`, ... For each activity put
     `class="bar"` on the cells of the weeks it runs, and leave the other cells empty.
   - `cost`: a `<table>`; header `Cost head`, `Y0`, `Y1`, `Y2`, ... then optionally `Total`; one row per cost
     line with plain numbers like `$75,000`; a row named `Benefits` for benefits per year.
   - `flow`: an `<ol>` with one process step per `<li>`, in order.
4. Any other slide is plain: a heading, then `<ul>` bullets or `<p>` paragraphs (4 to 7 bullets, one line each).
5. Speaker notes go in `<aside class="notes">...</aside>` inside the slide.
6. Do not rely on JavaScript to create content; all text must be present in the HTML source. CSS, navigation
   scripts and styling are fine but are ignored.
7. Do not invent figures. Use only numbers that appear in the brief.

Slides to include, in order: title, executive summary, current process, automated process (flow), assumptions,
scope, risks, execution plan (gantt), cost and benefits, next steps.

Brief:
<paste your brief here>

---

## What imports well, and what does not

| In your HTML | Imported as |
|---|---|
| `data-type` on a slide | the matching slide type, with structure |
| Title keywords without `data-type` (Assumptions, Risks, Scope, Next steps, Cost, Timeline) | the matching slide type when the content fits |
| Lists, paragraphs, tables | bullets |
| `<aside class="notes">` | speaker notes |
| Images, SVG, charts | not imported (a warning names them); recreate diagrams as a flow |

If a slide looked like a typed slide but its content did not match, it is imported as bullets and the warning says why.
