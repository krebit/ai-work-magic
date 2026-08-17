import { expect } from "vitest";
import { createAndSelectWorkspace, evalIn, go, waitFor } from "@openwork/behaviors";
import { desktop } from "@openwork/hosts";
import { needs, test } from "@openwork/testkit";

const enabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const title = enabled
  ? "a local workspace portfolio persists mixed vertical projects, children, and lifecycle"
  : "local portfolio workspace skipped — needs: set OPENWORK_EVAL_APP_SPECS=1";

async function setInput(app: Parameters<typeof evalIn>[0], label: string, value: string) {
  return evalIn(app, `(() => {
    const input = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
}

async function clickText(app: Parameters<typeof evalIn>[0], text: string) {
  return evalIn(app, `(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").trim() === ${JSON.stringify(text)});
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
}

test.skipIf(!enabled)(title, async ({ evidence }) => {
  needs({ optIn: ["OPENWORK_EVAL_APP_SPECS"] });
  await using app = await desktop({ name: "local-portfolio-workspace" });
  const workspace = await createAndSelectWorkspace(app, { path: `/tmp/openwork-local-portfolio-${Date.now()}` });
  const alternateWorkspace = await createAndSelectWorkspace(app, { path: `/tmp/openwork-local-portfolio-alternate-${Date.now()}` });
  await go(app, `/workspace/${workspace.workspaceId}/portfolio`);
  await waitFor(app, `(() => {
    const select = document.querySelector('select[aria-label="Portfolio workspace"]');
    return select instanceof HTMLSelectElement
      && select.value === ${JSON.stringify(workspace.workspaceId)}
      && [...select.options].some((option) => option.value === ${JSON.stringify(alternateWorkspace.workspaceId)});
  })()`, { timeoutMs: 60_000, label: "workspace-scoped portfolio picker" });
  evidence.fact("Portfolio exposes its workspace scope", "The active workspace is selected and the alternate workspace is available in the Portfolio picker.", true);
  await waitFor(app, `document.body.innerText.includes("Create this workspace’s portfolio")`, { timeoutMs: 60_000, label: "portfolio initialization UI" });

  expect(await setInput(app, "Portfolio name", "Creator Studio")).toBe(true);
  expect(await clickText(app, "Create portfolio")).toBe(true);
  await waitFor(app, `document.body.innerText.includes("Creator Studio") && document.body.innerText.includes("No projects yet")`, { timeoutMs: 30_000, label: "initialized portfolio" });
  evidence.fact("A workspace initializes one local Portfolio", "Creator Studio and its empty project state are visible after explicit initialization.", true);

  const createProject = async (input: { title: string; kind: string; vertical: string; parent?: string }) => {
    expect(await setInput(app, "Project title", input.title)).toBe(true);
    expect(await setInput(app, "Project kind", input.kind)).toBe(true);
    expect(await setInput(app, "Project vertical", input.vertical)).toBe(true);
    if (input.parent) {
      await evalIn(app, `(() => { const select = document.querySelector('select[aria-label="Parent project"]'); if (!(select instanceof HTMLSelectElement)) return false; select.value = ${JSON.stringify(input.parent)}; select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    }
    expect(await clickText(app, "Add")).toBe(true);
    await waitFor(app, `document.body.innerText.includes(${JSON.stringify(input.title)})`, { timeoutMs: 30_000, label: `created ${input.title}` });
  };

  await createProject({ title: "Moon Harbor", kind: "series", vertical: "short-drama" });
  const parentId = await evalIn(app, `document.querySelector('select[aria-label="Parent project"] option:nth-child(2)')?.getAttribute("value")`);
  expect(typeof parentId).toBe("string");
  await createProject({ title: "Episode One", kind: "episode", vertical: "short-drama", parent: String(parentId) });
  await createProject({ title: "Night Signals", kind: "album", vertical: "music" });

  const visible = await evalIn(app, `document.querySelector('[data-portfolio-page]')?.textContent ?? ""`);
  expect(String(visible)).toContain("Moon Harbor");
  expect(String(visible)).toContain("Episode One");
  expect(String(visible)).toContain("Night Signals");
  expect(String(visible)).toContain("short-drama");
  expect(String(visible)).toContain("music");
  evidence.fact("One Portfolio contains mixed verticals and one child project", "Moon Harbor, child Episode One, and music project Night Signals are visible together.", true);

  await evalIn(app, `(() => { const select = document.querySelector('select[aria-label="Lifecycle for Night Signals"]'); if (!(select instanceof HTMLSelectElement)) return false; select.value = "publication"; select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await waitFor(app, `document.querySelector('select[aria-label="Lifecycle for Night Signals"]')?.value === "publication"`, { timeoutMs: 30_000, label: "publication lifecycle" });
  await evalIn(app, "location.reload()");
  await waitFor(app, `document.body.innerText.includes("Night Signals") && document.querySelector('select[aria-label="Lifecycle for Night Signals"]')?.value === "publication"`, { timeoutMs: 60_000, label: "portfolio persisted after reload" });
  evidence.fact("Projects and lifecycle persist after desktop reload", "Night Signals remains visible at publication after reloading the desktop renderer.", true);
});
