const CHANNELS = [
  {
    name: "Web chat",
    description: "Chat privately from your browser.",
    href: "/chat",
    icon: "✦",
    tone: "violet",
    available: true
  },
  {
    name: "Telegram",
    description: "Continue in Telegram with quick commands.",
    href: process.env.NEXT_PUBLIC_TELEGRAM_URL,
    icon: "➤",
    tone: "blue",
    available: Boolean(process.env.NEXT_PUBLIC_TELEGRAM_URL)
  },
  {
    name: "WhatsApp",
    description: "Chat from the WhatsApp account.",
    href: process.env.NEXT_PUBLIC_WHATSAPP_URL,
    icon: "◉",
    tone: "green",
    available: Boolean(process.env.NEXT_PUBLIC_WHATSAPP_URL)
  }
];

export default function HomePage() {
  return (
    <main className="landing">
      <div className="landing-glow landing-glow-a" />
      <div className="landing-glow landing-glow-b" />
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Anonymous chat home">
          <span className="landing-mark">✦</span>
          <span>afterhours<span className="landing-dot">.</span></span>
        </a>
        <span className="landing-safety"><i /> Adults only · 18+</span>
      </header>

      <section className="landing-hero">
        <p className="landing-kicker">A LITTLE MORE HUMAN, A LITTLE MORE ANONYMOUS</p>
        <h1>Good conversations<br /><em>start anywhere.</em></h1>
        <p className="landing-intro">
          Meet someone new in a space that feels comfortable. Pick a channel and we’ll take it from there.
        </p>
      </section>

      <section className="channel-grid" aria-label="Available chat channels">
        {CHANNELS.map((channel) => (
          <a
            className={`channel-card channel-${channel.tone}${!channel.available ? " channel-disabled" : ""}`}
            href={channel.href}
            key={channel.name}
            aria-disabled={!channel.available}
            target={channel.name === "Web chat" ? undefined : "_blank"}
            rel={channel.name === "Web chat" ? undefined : "noreferrer"}
          >
            <span className="channel-icon">{channel.icon}</span>
            <span className="channel-copy">
              <strong>{channel.name}</strong>
              <small>{channel.available ? channel.description : "Not available yet"}</small>
            </span>
            <span className="channel-arrow">{channel.available ? "↗" : "·"}</span>
          </a>
        ))}
      </section>

      <footer className="landing-footer">
        <span>Your identity stays yours.</span>
        <span>Private by design <b>·</b> 18+ only</span>
      </footer>
      <style>{CSS}</style>
    </main>
  );
}

const CSS = `
.landing{--ink:#1f2335;--muted:#747a8f;position:relative;isolation:isolate;display:flex;min-height:100vh;flex-direction:column;overflow:hidden;padding:24px max(22px,calc((100vw - 1040px)/2));background:#f8f7fb;color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.landing:before{position:absolute;z-index:-2;inset:0;content:"";background:radial-gradient(ellipse at 50% 32%,#eeebff 0,transparent 45%),linear-gradient(150deg,#fbfaff,#f6f8fb 56%,#f3fbf7)}
.landing-glow{position:absolute;z-index:-1;width:330px;height:330px;border-radius:50%;filter:blur(2px);pointer-events:none}
.landing-glow-a{right:-160px;top:140px;background:radial-gradient(circle,#c9baff66,transparent 70%)}
.landing-glow-b{left:-185px;bottom:20px;background:radial-gradient(circle,#a9edcf70,transparent 70%)}
.landing-header{display:flex;align-items:center;justify-content:space-between}
.landing-brand{display:flex;align-items:center;gap:10px;color:var(--ink);font-size:18px;font-weight:850;letter-spacing:-.04em;text-decoration:none}
.landing-mark{display:grid;width:34px;height:34px;place-items:center;border:1px solid #ffffffd9;border-radius:12px;background:#ffffffa8;color:#7664d7;box-shadow:0 6px 18px #39326712}
.landing-dot{color:#8874ee}
.landing-safety{display:flex;align-items:center;gap:7px;color:#747a8f;font-size:11px;font-weight:700}
.landing-safety i{width:7px;height:7px;border-radius:50%;background:#47bd8c;box-shadow:0 0 0 4px #47bd8c1c}
.landing-hero{max-width:650px;margin:clamp(82px,15vh,152px) auto 40px;text-align:center}
.landing-kicker{margin:0 0 18px;color:#8575ce;font-size:10px;font-weight:850;letter-spacing:.18em}
.landing-hero h1{margin:0;font-size:clamp(44px,8vw,76px);line-height:.99;letter-spacing:-.075em}
.landing-hero h1 em{color:#7662d7;font-family:Georgia,serif;font-weight:500;letter-spacing:-.065em}
.landing-intro{max-width:420px;margin:22px auto 0;color:var(--muted);font-size:15px;line-height:1.7}
.channel-grid{display:grid;width:min(100%,760px);grid-template-columns:repeat(3,1fr);gap:13px;margin:0 auto}
.channel-card{position:relative;display:flex;min-height:155px;flex-direction:column;align-items:flex-start;justify-content:space-between;border:1px solid #e8e8f0;border-radius:20px;padding:18px;background:#ffffffb8;box-shadow:0 12px 35px #2429470a;color:var(--ink);text-decoration:none;transition:transform .2s,border-color .2s,box-shadow .2s}
.channel-card[href]:not(.channel-disabled):hover{transform:translateY(-4px);border-color:#d4ccfa;box-shadow:0 18px 38px #39326715}
.channel-disabled{opacity:.68;cursor:default}
.channel-icon{display:grid;width:40px;height:40px;place-items:center;border-radius:14px;font-size:19px;font-weight:800}
.channel-violet .channel-icon{background:#eeeaff;color:#725ed2}
.channel-blue .channel-icon{background:#e8f4ff;color:#2985ca}
.channel-green .channel-icon{background:#e6f8ee;color:#23945f}
.channel-copy{display:flex;flex-direction:column;gap:5px}
.channel-copy strong{font-size:15px;letter-spacing:-.02em}
.channel-copy small{color:var(--muted);font-size:11px;line-height:1.4}
.channel-arrow{position:absolute;right:17px;top:18px;color:#8e88a9;font-size:16px}
.landing-footer{display:flex;justify-content:space-between;gap:15px;width:min(100%,760px);margin:auto auto 0;padding-top:54px;color:#8d91a2;font-size:10px}
.landing-footer b{padding:0 5px;color:#c1bdd7}
@media(max-width:680px){.landing{padding:20px 18px}.landing-hero{margin:90px auto 32px}.channel-grid{grid-template-columns:1fr;gap:10px}.channel-card{min-height:100px;flex-direction:row;align-items:center;justify-content:flex-start;gap:14px;padding:15px}.channel-copy{flex:1}.channel-arrow{top:50%;transform:translateY(-50%)}.landing-footer{padding-top:40px}}
`;
