import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import { StrictMode, useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const repositoryUrl = "https://github.com/tentenco/RunDebrief";
const githubUrl = (import.meta.env.VITE_GITHUB_URL as string | undefined)?.trim();
const sourceHref = githubUrl || repositoryUrl;
const externalSourceProps = { target: "_blank" as const, rel: "noreferrer" };
const repositoryFileUrl = (file: string) => `${repositoryUrl}/blob/main/${file}`;

type Tone = "ember" | "teal" | "blue" | "violet";

const trustMarks = [
  ["Claude", "CODE"],
  ["OpenAI", "CODEX"],
  ["TAURI", "v2"],
  ["RUST", "STABLE"],
  ["React", "19"],
  ["TypeScript", "STRICT"],
  ["SQLite", "LOCAL"],
  ["VITEST", "TESTED"],
  ["macOS", "ALPHA"],
  ["JSONL", "ADAPTERS"],
  ["Apache", "2.0"],
  ["LOCAL", "FIRST"],
] as const;

const features: Array<{
  eyebrow: string;
  title: string;
  copy: string;
  tone: Tone;
  visual: "runs" | "agents" | "sources" | "resume";
  reverse?: boolean;
}> = [
  {
    eyebrow: "PARALLEL VISIBILITY",
    title: "See every agent run at once",
    copy: "Bring work spread across projects and terminal sessions into one calm view. Find what is running, what needs attention, and what was completed without reconstructing the timeline by hand.",
    tone: "ember",
    visual: "runs",
  },
  {
    eyebrow: "CROSS-AGENT CONTINUITY",
    title: "Works across coding agents",
    copy: "RunDebrief indexes Claude Code and Codex today through separate, tested adapters. One project view lets you follow the work instead of the provider that happened to run it.",
    tone: "teal",
    visual: "agents",
    reverse: true,
  },
  {
    eyebrow: "READ-ONLY BY DESIGN",
    title: "Histories stay untouched",
    copy: "Agent transcripts remain the source of record. RunDebrief reads approved roots incrementally, keeps its local SQLite index separate, and never rewrites the histories it observes.",
    tone: "blue",
    visual: "sources",
  },
  {
    eyebrow: "EVIDENCE-BACKED HANDOFF",
    title: "Resume with the right context",
    copy: "Open the summary, decisions, blockers, next steps, key files, and original turns behind a run. Start the next session from evidence instead of archaeology.",
    tone: "violet",
    visual: "resume",
    reverse: true,
  },
];

const proofCards = [
  {
    tag: "SOURCE SAFETY",
    title: "Read-only by construction",
    copy: "The scanner reads supported histories. It does not rewrite ~/.claude or ~/.codex.",
  },
  {
    tag: "PARSING",
    title: "Incremental scan offsets",
    copy: "Large histories are not reparsed from the beginning on every refresh.",
  },
  {
    tag: "ORIENTATION",
    title: "Project-first, not terminal-first",
    copy: "Runs are grouped around the work so provider and process details stay useful without owning the experience.",
  },
  {
    tag: "TRUST",
    title: "Evidence behind the recap",
    copy: "Original user and assistant turns remain one disclosure away when a summary needs verification.",
  },
  {
    tag: "DEGRADED MODE",
    title: "No gateway, no mystery",
    copy: "Ended runs use a deterministic rules fallback when no summary gateway is configured.",
  },
  {
    tag: "STATUS",
    title: "Observed state stays explicit",
    copy: "Runtime signal, recency, summary state, and attention needs are presented as separate facts.",
  },
  {
    tag: "ADAPTERS",
    title: "Claude Code + Codex today",
    copy: "Each source format sits behind an adapter contract with anonymized fixtures and strict parsing tests.",
  },
  {
    tag: "LOCAL CORE",
    title: "SQLite on your machine",
    copy: "The index lives locally. The optional configured gateway boundary is described plainly rather than hidden in a slogan.",
  },
  {
    tag: "HANDOFF",
    title: "Next steps stay actionable",
    copy: "Decisions, blockers, key files, and the next useful action turn a finished run into a continuation point.",
  },
  {
    tag: "OPEN SOURCE",
    title: "Apache-2.0 foundation",
    copy: "Personal and commercial use stay open with an explicit patent grant for contributors and adopters.",
  },
  {
    tag: "PRODUCT TRUTH",
    title: "Alpha claims stay honest",
    copy: "macOS source build now. Signed releases, more operating systems, iOS, and remote prompting remain future gates.",
  },
] as const;

const faqs = [
  {
    question: "Is this another terminal or agent launcher?",
    answer:
      "No. RunDebrief observes supported runs even when it did not launch them. Its job is continuity: help you understand what happened, verify the evidence, and decide what should happen next.",
  },
  {
    question: "Which coding agents are supported?",
    answer:
      "The current alpha supports Claude Code and Codex histories through separate adapters. More providers should arrive only with a tested adapter and anonymized fixtures—not a generic compatibility claim.",
  },
  {
    question: "Does it modify my Claude Code or Codex history?",
    answer:
      "No. Those histories are read-only inputs. RunDebrief keeps its own local index and only writes the small set of product preferences documented by the desktop app.",
  },
  {
    question: "Is RunDebrief free and open source?",
    answer:
      "The repository foundation uses Apache-2.0, so personal and commercial use are permitted with an explicit patent grant. Optional hosted or team services can be evaluated later without closing the local core.",
  },
  {
    question: "Can I monitor or prompt agents from iPhone yet?",
    answer:
      "Not yet. The intended sequence is read-only mobile status and evidence first, followed by device identity, encryption, revocation, audit history, and only then guarded continuation that preserves the underlying agent permission model.",
  },
] as const;

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <path d={down ? "M8 2v11m0 0 4-4m-4 4-4-4" : "M4 12 12 4m0 0H6m6 0v6"} />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .27.18.59.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="wordmark" aria-label="RunDebrief">
      <span>RUN</span>DEBRIEF
    </span>
  );
}

function SourceLink({ className = "button primary-cta", children = "Explore the source" }) {
  return (
    <a className={className} href={sourceHref} {...externalSourceProps}>
      <span>{children}</span>
      <Arrow />
    </a>
  );
}

function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const close = () => setOpen(false);

  return (
    <header className="site-header">
      <div className="header-shell">
        <a className="header-brand" href="#top" aria-label="RunDebrief home" onClick={close}>
          <Wordmark />
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#why">Why</a>
          <a href="#roadmap">Roadmap</a>
          <a href="#team">Team</a>
        </nav>
        <div className="header-actions">
          <a className="github-proof" href={sourceHref} {...externalSourceProps}>
            <GithubIcon />
            <span>Apache-2.0</span>
          </a>
          <SourceLink className="header-cta" children="Build from source" />
        </div>
        <button
          className="menu-trigger"
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
        </button>
      </div>
      <div id="mobile-menu" className="mobile-menu" data-open={open ? "true" : "false"}>
        <a href="#product" onClick={close}>Product</a>
        <a href="#why" onClick={close}>Why RunDebrief</a>
        <a href="#roadmap" onClick={close}>Roadmap</a>
        <a href="#team" onClick={close}>Team</a>
        <a href={sourceHref} {...externalSourceProps} onClick={close}>Explore the source <Arrow /></a>
      </div>
    </header>
  );
}

function FluidField({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const palette: Record<Tone, [number, number, number]> = {
      ember: [205, 54, 28],
      teal: [0, 154, 116],
      blue: [45, 79, 222],
      violet: [104, 50, 207],
    };
    const [red, green, blue] = palette[tone];
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = true;
    let pageVisible = !document.hidden;
    let cssWidth = 0;
    let cssHeight = 0;

    const fit = () => {
      const bounds = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, bounds.width);
      cssHeight = Math.max(1, bounds.height);
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(cssWidth * scale);
      const height = Math.round(cssHeight * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const draw = (time: number) => {
      fit();
      context.clearRect(0, 0, cssWidth, cssHeight);
      context.fillStyle = "#070807";
      context.fillRect(0, 0, cssWidth, cssHeight);

      const glow = context.createRadialGradient(
        tone === "teal" || tone === "violet" ? cssWidth * 0.18 : cssWidth * 0.82,
        cssHeight * 0.55,
        0,
        cssWidth * 0.5,
        cssHeight * 0.5,
        cssWidth * 0.72,
      );
      glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, .17)`);
      glow.addColorStop(0.5, `rgba(${red}, ${green}, ${blue}, .045)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, cssWidth, cssHeight);

      const phase = (prefersReducedMotion ? 1700 : time) / 6200;
      const direction = tone === "teal" || tone === "violet" ? -1 : 1;
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      for (let index = 0; index < 9; index += 1) {
        const offset = (index - 4) * cssHeight * 0.024;
        const wave = Math.sin(phase * Math.PI * 2 + index * 0.47) * cssHeight * 0.055;
        const startX = direction > 0 ? -cssWidth * 0.18 : cssWidth * 1.18;
        const endX = direction > 0 ? cssWidth * 1.15 : -cssWidth * 0.15;
        const anchorY = cssHeight * (0.58 + (tone === "blue" ? 0.06 : -0.02));
        context.beginPath();
        context.moveTo(startX, anchorY + offset + wave);
        context.bezierCurveTo(
          cssWidth * (direction > 0 ? 0.18 : 0.82),
          cssHeight * (0.08 + index * 0.018) + wave,
          cssWidth * (direction > 0 ? 0.64 : 0.36),
          cssHeight * (0.92 - index * 0.013) - wave,
          endX,
          cssHeight * (0.38 + index * 0.014),
        );
        context.strokeStyle = `rgba(${red + Math.min(index * 3, 30)}, ${green + Math.min(index * 2, 24)}, ${blue + Math.min(index * 4, 32)}, ${0.055 + index * 0.012})`;
        context.lineWidth = cssWidth * (0.022 + index * 0.0025);
        context.shadowBlur = cssWidth * 0.045;
        context.shadowColor = `rgba(${red}, ${green}, ${blue}, .34)`;
        context.stroke();
      }

      context.globalCompositeOperation = "source-over";
      context.shadowBlur = 0;
      const vignette = context.createRadialGradient(cssWidth / 2, cssHeight / 2, cssWidth * 0.1, cssWidth / 2, cssHeight / 2, cssWidth * 0.72);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,.72)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, cssWidth, cssHeight);
    };

    const loop = (time: number) => {
      draw(time);
      if (!prefersReducedMotion && visible && pageVisible) frame = requestAnimationFrame(loop);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      if (prefersReducedMotion) draw(1700);
      else if (visible && pageVisible) frame = requestAnimationFrame(loop);
    };

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    }, { rootMargin: "120px" });
    const resize = new ResizeObserver(start);
    const onVisibility = () => {
      pageVisible = !document.hidden;
      start();
    };

    intersection.observe(canvas);
    resize.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      cancelAnimationFrame(frame);
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tone]);

  return (
    <div className={`fluid-field fluid-${tone}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="field-grain" aria-hidden="true" />
      {children}
    </div>
  );
}

function FieldUI({ type }: { type: "runs" | "agents" | "sources" | "resume" }) {
  if (type === "runs") {
    return (
      <div className="field-ui field-ui-runs" aria-hidden="true">
        <div className="mini-top"><span>Attention</span><b>3 runs</b></div>
        <div className="mini-run"><i className="dot running" /><span>checkout-runtime</span><small>RUNNING</small></div>
        <div className="mini-run"><i className="dot waiting" /><span>api-contract</span><small>WAITING</small></div>
        <div className="mini-run"><i className="dot done" /><span>landing-foundation</span><small>COMPLETE</small></div>
      </div>
    );
  }

  if (type === "agents") {
    return (
      <div className="field-ui field-ui-agents" aria-hidden="true">
        <div className="mini-top"><span>Agent source</span><b>2 adapters</b></div>
        <div className="agent-options"><span className="selected">All runs</span><span>Claude Code</span><span>Codex</span></div>
        <p>One project timeline.</p>
      </div>
    );
  }

  if (type === "sources") {
    return (
      <div className="field-ui field-ui-sources" aria-hidden="true">
        <div className="mini-top"><span>Data sources</span><b className="healthy">HEALTHY</b></div>
        <div className="source-line"><span>~/.claude</span><small>READ ONLY</small></div>
        <div className="source-line"><span>~/.codex</span><small>READ ONLY</small></div>
        <div className="source-foot"><i className="dot running" /> incremental scan active</div>
      </div>
    );
  }

  return (
    <div className="field-ui field-ui-resume" aria-hidden="true">
      <div className="mini-top"><span>Run debrief</span><b>READY</b></div>
      <div className="resume-tabs"><span className="selected">Summary</span><span>Original turns</span></div>
      <strong>Continue from verified context</strong>
      <p>3 next steps · 4 key files</p>
      <div className="field-action">Open handoff <Arrow /></div>
    </div>
  );
}

function FAQItem({ question, answer, open, onToggle }: { question: string; answer: string; open: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <div className="faq-item" data-open={open ? "true" : "false"}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span>{question}</span>
        <i aria-hidden="true" />
      </button>
      <div className="faq-answer" id={id} hidden={!open}>
        <p>{answer}</p>
      </div>
    </div>
  );
}

function App() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    document.documentElement.dataset.motion = "enhanced";
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
    nodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      delete document.documentElement.dataset.motion;
    };
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div id="top" />
      <Header />
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy reveal">
            <h1 id="hero-title">The Debrief for AI Agents<span className="hero-period">.</span><span className="hero-cursor" aria-hidden="true" /></h1>
            <p>Review every coding-agent run in one place. Built for Claude Code and Codex. Open source by default.</p>
            <div className="hero-actions">
              <SourceLink />
              <a className="button secondary-cta" href="#product"><span>View the product</span><GithubIcon /></a>
            </div>
          </div>
          <a className="hero-product" href="/screenshots/overview-dark.png" target="_blank" rel="noreferrer">
            <img src="/screenshots/overview-dark.png" alt="RunDebrief project overview showing Claude Code and Codex runs grouped by project" />
            <span className="sr-only">Open the real alpha screenshot at full resolution</span>
          </a>
        </section>

        <section className="trust" aria-labelledby="trust-title">
          <h2 id="trust-title">Built on tools and standards you can inspect</h2>
          <div className="trust-grid">
            {trustMarks.map(([name, detail]) => (
              <div className="trust-cell" key={`${name}-${detail}`}>
                <strong>{name}</strong>
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="product" className="features" aria-label="RunDebrief product features">
          {features.map((feature, index) => (
            <article className={`feature ${feature.reverse ? "feature-reverse" : ""}`} key={feature.title}>
              <div className="feature-copy reveal">
                <p className="eyebrow">{feature.eyebrow}</p>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </div>
              <div className="feature-visual reveal" style={{ "--reveal-delay": `${80 + index * 10}ms` } as React.CSSProperties}>
                <FluidField tone={feature.tone}><FieldUI type={feature.visual} /></FluidField>
              </div>
            </article>
          ))}
        </section>

        <section id="why" className="proof-section">
          <div className="section-shell">
            <h2 className="section-heading reveal">What the product proves today</h2>
            <div className="proof-wall reveal">
              {proofCards.map((card, index) => (
                <article className={`proof-card proof-card-${(index % 4) + 1}`} key={card.title}>
                  <div className="proof-meta"><span className={`proof-avatar proof-avatar-${(index % 5) + 1}`}>{String(index + 1).padStart(2, "0")}</span><span>{card.tag}</span></div>
                  <h3>{card.title}</h3>
                  <p>{card.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="roadmap" className="faq-section">
          <div className="faq-shell">
            <h2 className="section-heading reveal">Frequently<br />asked questions</h2>
            <div className="faq-list reveal">
              {faqs.map((faq, index) => (
                <FAQItem
                  key={faq.question}
                  {...faq}
                  open={openFaq === index}
                  onToggle={() => setOpenFaq((current) => current === index ? null : index)}
                />
              ))}
            </div>
          </div>
        </section>

        <section id="open-source" className="final-cta">
          <div className="reveal">
            <h2>Try RunDebrief now.</h2>
            <SourceLink className="button primary-cta final-button" children="Explore the source" />
            <p>macOS source-build alpha · Apache-2.0</p>
          </div>
        </section>
      </main>

      <footer id="team" className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <a href="#top"><Wordmark /></a>
            <p>An open-source debrief and continuity layer for coding agents, built by Tenten.</p>
            <div className="social-row">
              <a href={sourceHref} {...externalSourceProps} aria-label="RunDebrief source on GitHub"><GithubIcon /></a>
              <a href="https://tenten.co/" target="_blank" rel="noreferrer" aria-label="Tenten website">TT</a>
            </div>
          </div>
          <div className="footer-links">
            <div><h3>Product</h3><a href="#product">Features</a><a href="#why">Why</a><a href="#roadmap">FAQ</a><a href={sourceHref} {...externalSourceProps}>Source</a></div>
            <div><h3>Resources</h3><a href={repositoryFileUrl("README.md")} {...externalSourceProps}>README</a><a href="#roadmap">Roadmap</a><a href={repositoryFileUrl("SECURITY.md")} {...externalSourceProps}>Security</a><a href={repositoryFileUrl("CONTRIBUTING.md")} {...externalSourceProps}>Contribute</a></div>
            <div><h3>Company</h3><a href="https://tenten.co/" target="_blank" rel="noreferrer">Tenten</a><a href="https://tenten.co/contact" target="_blank" rel="noreferrer">Contact</a><a href={repositoryFileUrl("LICENSE")} {...externalSourceProps}>Apache-2.0</a><a href="#top">Back to top</a></div>
          </div>
        </div>
        <div className="footer-bottom"><span>© 2026 Tenten. RunDebrief is a public working name.</span><span>Internal code name: Debrief</span></div>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
