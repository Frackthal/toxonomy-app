import React from 'react';

function Documentation() {
  const sections = [
    {
      title: 'CLP',
      content: `La classification CLP, pour Classification, Labelling and Packaging (Classification, étiquetage et emballage), est un système utilisé dans l’Union européenne pour classer les substances chimiques selon leurs dangers et fournir des étiquettes et des fiches de données de sécurité normalisées.`
    },
    {
      title: 'GHS Australia',
      content: `Le GHS Australia désigne l’adoption et la mise en œuvre du Système général harmonisé de classification et d’étiquetage des produits chimiques (GHS) dans le cadre réglementaire australien. Il aligne la classification et l’étiquetage des substances chimiques sur les normes internationales afin d’améliorer la sécurité lors de leur manipulation, de leur transport et de leur utilisation. Il combine des éléments du système CLP européen et de la classification GHS de la Nouvelle-Zélande.`
    },
    {
      title: 'GHS Japan',
      content: `Le GHS Japan correspond à l’adoption et à l’application du Système général harmonisé (GHS) dans la réglementation japonaise, afin d’harmoniser la classification et l’étiquetage des substances chimiques avec les normes internationales, dans le but d’améliorer la sécurité lors de leur manipulation, transport et utilisation.`
    },
    {
      title: 'GHS Korea',
      content: `Le GHS Korea désigne la mise en œuvre du GHS dans le cadre réglementaire de la Corée du Sud, alignant la classification et l’étiquetage des substances chimiques sur les standards internationaux pour renforcer la sécurité lors de la manipulation, du transport et de l’utilisation de ces substances.`
    },
    {
      title: 'GHS China',
      content: `Le GHS China fait référence à l’adoption du GHS en Chine, visant à harmoniser la classification et l’étiquetage des produits chimiques avec les normes internationales, pour garantir une manipulation, un transport et une utilisation plus sûrs.`
    },
    {
      title: 'BKH DHI',
      content: `La liste BKH DHI des perturbateurs endocriniens a été élaborée par l’Institut fédéral allemand d’évaluation des risques (BKH) en collaboration avec le Centre danois sur les perturbateurs endocriniens (DHI). Elle répertorie les substances susceptibles d’interférer avec le fonctionnement du système endocrinien.`
    },
    {
      title: 'DEDuCT',
      content: `La liste DEDuCT, constituée par l’Institute of Mathematical Sciences (IMSc) à Chennai, recense des substances chimiques suspectées d’être des perturbateurs endocriniens.`
    },
    {
      title: 'EU EDLists',
      content: `Les EDLists de l’UE, compilées par l’Union européenne, sont constituées de plusieurs listes identifiant des substances présentant des propriétés de perturbation endocrinienne.`
    },
    {
      title: 'FEMA',
      content: `La liste FEMA (Flavor and Extract Manufacturers Association), élaborée pour le compte de l’OSHA (Occupational Safety and Health Administration), identifie des substances aromatisantes pouvant présenter des risques respiratoires sur les lieux de travail dans l’industrie des arômes.`
    },
    {
      title: 'HPHC',
      content: `La liste HPHC (constituants nocifs et potentiellement nocifs), établie par la Food and Drug Administration (FDA) des États-Unis, recense les substances nocives ou potentiellement nocives présentes dans les produits du tabac ou leur fumée.`
    },
    {
      title: 'IARC',
      content: `La liste des cancérogènes du CIRC (Centre international de recherche sur le cancer) classe les substances et agents selon leur cancérogénicité pour l’humain, sur la base de données scientifiques.`
    },
    {
      title: 'NTP Carcinogens',
      content: `La liste des cancérogènes du NTP (National Toxicology Program), gérée par le Département de la santé des États-Unis, identifie les substances reconnues ou supposées provoquer le cancer chez l’humain.`
    },
    {
      title: 'MAK Allergènes',
      content: `La liste des allergènes MAK, établie par la Commission allemande pour l’étude des risques pour la santé liés aux composés chimiques sur le lieu de travail, identifie les substances susceptibles d’induire des réactions allergiques chez les individus sensibilisés.`
    },
    {
      title: 'MAK Cancérogènes',
      content: `La liste des cancérogènes MAK regroupe les substances classées comme cancérogènes par la Commission allemande d’évaluation des risques chimiques en milieu professionnel (Commission MAK). Les substances sont réparties en différentes catégories selon leur potentiel cancérogène chez l’humain ou l’animal, leur mode d’action et leur puissance cancérogène.`
    },
    {
      title: 'SINList',
      content: `La SINList (Substitute It Now!), élaborée par le International Chemical Secretariat (ChemSec), met en avant des substances préoccupantes présentes dans divers produits ou secteurs, en recommandant leur substitution par des alternatives plus sûres pour la santé humaine et l’environnement.`
    },
    {
      title: 'TEDX',
      content: `La liste TEDX (The Endocrine Disruption Exchange) répertorie des substances reconnues ou suspectées d’interférer avec le fonctionnement du système endocrinien.`
    },
    {
      title: 'US EPA Carcinogens',
      content: `La liste des cancérogènes de l’EPA américaine (Environmental Protection Agency) recense les substances reconnues pour leurs propriétés cancérogènes.`
    },
    {
      title: 'US EPA Endocrine Disruptors',
      content: `La liste des perturbateurs endocriniens de l’EPA américaine identifie les substances susceptibles d’interférer avec le système endocrinien.`
    }
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto text-sm leading-relaxed">
      <h1 className="text-2xl font-bold mb-6">Documentation</h1>
      {sections.map((section, index) => (
        <div key={index} className="mb-6">
          <h2 className="text-xl font-semibold mb-2 text-blue-700 dark:text-blue-300">{section.title}</h2>
          <p className="text-gray-800 dark:text-gray-100">{section.content}</p>
        </div>
      ))}
    </div>
  );
}

export default Documentation;