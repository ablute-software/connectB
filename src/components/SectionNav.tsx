'use client';
// Prompt 213 §B — a barra de secções do Overview do dossier.
//
// Lê-se como abas, comporta-se como âncoras (decisão do Nuno). A diferença
// importa: com abas verdadeiras, quem quer percorrer o dossier de uma ponta à
// outra — ou imprimi-lo — deixa de o conseguir num scroll, e um investidor a
// avaliar costuma querer exactamente isso. Assim tem as duas coisas.
//
// As secções são DESCOBERTAS no DOM (`[data-section]`), não passadas numa
// lista. É deliberado: a página já decide quais existem, cada uma com a sua
// condição (há roadmap? há clarifications?), e uma segunda lista aqui
// divergiria da primeira ao terceiro `&&` que alguém acrescentasse.
import { useEffect, useState } from 'react';

export function SectionNav({ containerId }: { containerId: string }) {
  const [sections, setSections] = useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const root = document.getElementById(containerId);
    if (!root) return;
    const found = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'))
      .map((el) => ({ id: el.id, label: el.dataset.section ?? '' }))
      .filter((s) => s.id && s.label);
    setSections(found);
    if (found.length === 0) return;

    // Scroll-spy. rootMargin empurra a linha de deteccao para o terço
    // superior: sem isso, a secção "activa" mudava só quando ela já estava a
    // sair do ecrã, que é tarde de mais para ser útil.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -66% 0px', threshold: 0 },
    );
    for (const s of found) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [containerId]);

  if (sections.length < 2) return null;

  return (
    <nav className="sticky top-0 z-20 -mx-1 mb-3 flex gap-1 overflow-x-auto border-b border-gray-200 bg-[#F7F9FA]/95 px-1 py-2 backdrop-blur">
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`}
          onClick={() => setActive(s.id)}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            active === s.id ? 'bg-[#0E7490] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
