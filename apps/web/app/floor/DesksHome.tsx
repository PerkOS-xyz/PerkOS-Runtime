"use client";

import { useEffect, useState } from "react";
import { ChainMark } from "./ChainMark";
import { chainOf, deskManifest, deskLimit, DESK_MODULES, CHAINS } from "./deskManifest";

// Fuera del desk: el catalogo de PerkOS a la izquierda y mis desks a la derecha. Un desk es un
// proyecto de la wallet, asi que los dos lados son lo mismo visto desde dos momentos: lo que se
// puede montar y lo que ya esta montado. Aqui no se gasta nada: se abre un desk o se vuelve.

export type DeskTemplateCard = { id: string; revision: number; name: string; description: string; agents: Array<{ role: string; name: string; duty: string }>; module?: string; chain?: string; tagline?: string; venues?: string; screens?: string[]; instances?: string };
export type DeskProjectCard = { projectId: string; templateId: string; name: string; goal: string; status: string; agents: number; updatedAt?: string };

const when = (iso?: string): string => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

export default function DesksHome({ selected, onOpen, onClose, onSetUp, who, onLogout }: {
  /** El desk activo, por su templateId. */
  selected: string;
  onOpen: (templateId: string) => void;
  onClose: () => void;
  /** Montar el equipo de un template que todavia no tiene desk: lo hace el wizard. */
  onSetUp: (templateId: string) => void;
  /** La cuenta con la que se entro. Aqui es util: un desk es de una wallet. */
  who?: string;
  onLogout?: () => void;
}) {
  const [templates, setTemplates] = useState<DeskTemplateCard[] | null>(null);
  const [desks, setDesks] = useState<DeskProjectCard[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/desks?lang=${encodeURIComponent((navigator.language || "en").slice(0, 2))}`)
      .then((r) => r.json())
      .then((j: { templates?: DeskTemplateCard[]; desks?: DeskProjectCard[]; error?: string; detail?: string }) => {
        if (!live) return;
        if (j.error) { setTemplates([]); setNote(j.detail || j.error); return; }
        setTemplates(j.templates ?? []);
        setDesks(j.desks ?? []);
      })
      .catch((e) => live && (setTemplates([]), setNote(String(e))));
    return () => { live = false; };
  }, []);

  const deskFor = (templateId: string) => desks.find((d) => d.templateId === templateId);

  return (
    <div className="desks-home">
      <header>
        <div className="dh-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-name.png" alt="PerkOS" />
          <span>Desks</span>
        </div>
        {/* Fuera del desk es donde se cambia de cuenta: el desk pertenece a una wallet. */}
        <div className="dh-acct">
          {who ? <span title="The wallet this desk belongs to">{who}</span> : null}
          <button type="button" className="dh-back" onClick={onClose}>Back to the desk</button>
          {onLogout ? <button type="button" className="dh-out" onClick={onLogout}>Log out</button> : null}
        </div>
      </header>
      <p className="dh-lead">A desk is a project on PerkOS: it brings its team, its chain and its screens. Browse the catalogue on the left, open one you already run on the right.</p>

      <div className="dh-cols">
        <section aria-labelledby="dh-catalog">
          <div className="dh-label">
            <h2 id="dh-catalog">Desk templates</h2>
            <small>{templates === null ? "reading PerkOS" : `${templates.length} ${templates.length === 1 ? "template" : "templates"}`}</small>
          </div>
          {/* La vitrina: el catalogo va dentro de una caja elevada, lo mio queda al ras. */}
          <div className="dh-case">
          {templates === null ? <p className="dh-empty">Reading PerkOS…</p> : null}
          {templates && !templates.length ? <p className="dh-empty">{note || "No desk template published yet."}</p> : null}
          {/* Una carta por template, en fila con scroll: se pasa a la siguiente como en un album. */}
          <ul className="dh-deck">
            {(templates ?? []).map((t, i) => {
              const m = deskManifest(t);
              const mine = deskFor(t.id);
              const limit = deskLimit(t, !!mine);
              const chain = chainOf(t);
              return (
                <li key={t.id} className={`dh-tcard ${chain}`}>
                  <header>
                    <span>Desk template</span>
                    <ChainMark chain={chain} small />
                  </header>
                  {/* El arte de la carta: la marca, el nombre del desk en grande y Sparky, que es la voz. */}
                  <div className="dh-art">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="dh-art-logo" src="/logo.png" alt="PerkOS" draggable={false} />
                    <b>{t.name}</b>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="dh-art-sparky" src="/sparky-full.png" alt="" draggable={false} />
                  </div>
                  <div className="dh-type">{DESK_MODULES[m.module].label}</div>
                  <p>{t.description}</p>
                  <dl className="dh-stats">
                    <div><dt>Chain</dt><dd>{CHAINS[chain].name}</dd></div>
                    <div><dt>Agents</dt><dd>{t.agents.length}</dd></div>
                    <div><dt>Screens</dt><dd>{m.screens.length || "–"}</dd></div>
                  </dl>
                  <footer>
                    {/* Un desk que vive de la wallet es uno por wallet: en vez de un boton muerto,
                        se abre el que ya existe y se dice por que no hay un segundo. */}
                    {mine && limit ? (
                      <button type="button" className="go" onClick={() => onOpen(t.id)} title={limit}>Open your desk</button>
                    ) : mine ? (
                      <button type="button" className="go" onClick={() => onSetUp(t.id)}>Set up another</button>
                    ) : (
                      <button type="button" className="go" onClick={() => onSetUp(t.id)}>Set up this desk</button>
                    )}
                    <small>{i + 1} of {(templates ?? []).length}</small>
                  </footer>
                  {limit ? <p className="dh-limit">{limit}</p> : null}
                </li>
              );
            })}
          </ul>
          </div>
        </section>

        <i className="dh-split" aria-hidden="true" />

        <section aria-labelledby="dh-mine">
          <div className="dh-label">
            <h2 id="dh-mine">Your desks</h2>
            <small>{desks.length ? `${desks.length} running` : "none yet"}</small>
          </div>
          {templates && !desks.length ? <p className="dh-empty">No desk yet. Set one up from a template and it appears here.</p> : null}
          <ul>
            {desks.map((d) => {
              const t = (templates ?? []).find((x) => x.id === d.templateId);
              const on = d.templateId === selected;
              return (
                <li key={d.projectId} className={`dh-card${on ? " on" : ""}`}>
                  <div className="dh-head">
                    <b>{d.name}</b>
                    {t ? <ChainMark chain={chainOf(t)} small /> : null}
                  </div>
                  <p>{d.goal}</p>
                  <div className="dh-facts">
                    <span>{d.status}</span>
                    <span>{d.agents} agents</span>
                    {d.updatedAt ? <span>{when(d.updatedAt)}</span> : null}
                  </div>
                  <button type="button" className={on ? "" : "go"} onClick={() => onOpen(d.templateId)}>{on ? "Open again" : "Open"}</button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
