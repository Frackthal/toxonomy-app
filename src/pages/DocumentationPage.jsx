import React, { useState, useMemo } from 'react';
import { Search, ExternalLink } from 'lucide-react';

const sections = [
  {
    group: 'GHS',
    items: [
      { title: 'CLP', content: 'La classification CLP (Classification, Labelling and Packaging) est le système utilisé dans l\'Union européenne pour classer les substances chimiques selon leurs dangers et fournir des étiquettes et des fiches de données de sécurité normalisées.' },
      { title: 'CLP Notifications', content: 'La base CLP Notifications regroupe les classifications et étiquetages déclarés par les fabricants, importateurs et utilisateurs en aval dans le cadre du règlement CLP. Elle reflète les notifications soumises au niveau européen.' },
      { title: 'GHS Australia', content: 'Le GHS Australia aligne la classification et l\'étiquetage des substances chimiques sur les normes internationales. Il combine des éléments du système CLP européen et de la classification GHS de la Nouvelle-Zélande.' },
      { title: 'GHS Japan', content: 'Le GHS Japan correspond à l\'adoption du Système général harmonisé dans la réglementation japonaise, afin d\'harmoniser la classification et l\'étiquetage des substances chimiques.' },
      { title: 'GHS Korea', content: 'Le GHS Korea désigne la mise en œuvre du GHS dans le cadre réglementaire de la Corée du Sud.' },
      { title: 'GHS China', content: 'Le GHS China fait référence à l\'adoption du GHS en Chine, visant à harmoniser la classification et l\'étiquetage des produits chimiques avec les normes internationales.' },
      { title: 'GHS Taiwan', content: 'Le GHS Taiwan correspond à la mise en œuvre du GHS dans la réglementation taïwanaise.' },
      { title: 'GHS Malaysia', content: 'Le GHS Malaysia désigne l\'adoption du GHS par la Malaisie, unifiant la classification et l\'étiquetage des produits chimiques.' },
      { title: 'SIMDUT 2015', content: 'Le SIMDUT 2015, transposition canadienne du GHS, harmonise la classification, l\'étiquetage et les fiches de données de sécurité des produits chimiques au Canada.' },
    ]
  },
  {
    group: 'Cancérogénicité',
    items: [
      { title: 'IARC', content: 'La liste des cancérogènes du CIRC (Centre international de recherche sur le cancer) classe les substances et agents selon leur cancérogénicité pour l\'humain, sur la base de données scientifiques.' },
      { title: 'NTP Carcinogens', content: 'La liste des cancérogènes du NTP (National Toxicology Program) identifie les substances reconnues ou supposées provoquer le cancer chez l\'humain.' },
      { title: 'MAK Cancérogènes', content: 'La liste des cancérogènes MAK regroupe les substances classées comme cancérogènes par la Commission allemande d\'évaluation des risques chimiques en milieu professionnel.' },
      { title: 'US EPA Carcinogens', content: 'La liste des cancérogènes de l\'EPA américaine recense les substances reconnues pour leurs propriétés cancérogènes.' },
    ]
  },
  {
    group: 'Perturbateurs endocriniens',
    items: [
      { title: 'BKH DHI', content: 'La liste BKH DHI des perturbateurs endocriniens a été élaborée par l\'Institut fédéral allemand d\'évaluation des risques en collaboration avec le Centre danois sur les perturbateurs endocriniens.' },
      { title: 'DEDuCT', content: 'La liste DEDuCT, constituée par l\'Institute of Mathematical Sciences (IMSc) à Chennai, recense des substances chimiques suspectées d\'être des perturbateurs endocriniens.' },
      { title: 'EU EDLists', content: 'Les EDLists de l\'UE sont constituées de plusieurs listes identifiant des substances présentant des propriétés de perturbation endocrinienne.' },
      { title: 'SINList', content: 'La SINList (Substitute It Now!), élaborée par ChemSec, met en avant des substances préoccupantes en recommandant leur substitution par des alternatives plus sûres.' },
      { title: 'TEDX', content: 'La liste TEDX répertorie des substances reconnues ou suspectées d\'interférer avec le fonctionnement du système endocrinien.' },
      { title: 'US EPA Endocrine Disruptors', content: 'La liste des perturbateurs endocriniens de l\'EPA américaine identifie les substances susceptibles d\'interférer avec le système endocrinien.' },
    ]
  },
  {
    group: 'Autres',
    items: [
      { title: 'ATSDR Hazards', content: 'Les ATSDR Hazards rassemblent les effets sanitaires associés à l\'exposition à diverses substances chimiques, organisés par systèmes d\'organes et types d\'effets.' },
      { title: 'FEMA', content: 'La liste FEMA identifie des substances aromatisantes pouvant présenter des risques respiratoires sur les lieux de travail dans l\'industrie des arômes.' },
      { title: 'HPHC', content: 'La liste HPHC, établie par la FDA, recense les substances nocives ou potentiellement nocives présentes dans les produits du tabac ou leur fumée.' },
      { title: 'MAK Allergènes', content: 'La liste des allergènes MAK identifie les substances susceptibles d\'induire des réactions allergiques chez les individus sensibilisés.' },
    ]
  },
];

const GROUP_COLORS = {
  'GHS': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'Cancérogénicité': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'Perturbateurs endocriniens': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Autres': 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
};

export default function DocumentationPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.map(group => ({
      ...group,
      items: group.items.filter(
        item => item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q)
      ),
    })).filter(group => group.items.length > 0);
  }, [searchQuery]);

  return (
    <div className="max-w-3xl mx-auto p-4 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-display italic text-[var(--text-primary)] mb-2">Documentation</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Descriptions des sources de classification et bases de données toxicologiques disponibles dans Toxonomy.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Rechercher dans la documentation…"
          className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--surface-0)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-tox-500/30 focus:border-tox-500"
        />
      </div>

      {/* Sections */}
      <div className="space-y-8">
        {filteredSections.map(group => (
          <div key={group.group}>
            <div className="flex items-center gap-2 mb-4">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${GROUP_COLORS[group.group] || ''}`}>
                {group.group}
              </span>
              <div className="flex-1 h-px bg-[var(--border-color)]" />
            </div>
            <div className="space-y-3">
              {group.items.map(item => (
                <div
                  key={item.title}
                  className="rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] p-4"
                >
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1.5">{item.title}</h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{item.content}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
