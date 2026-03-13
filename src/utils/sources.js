export const SOURCES = [
  { label: 'CLP', value: 'CLP', group: 'GHS' },
  { label: 'CLP Notifications', value: 'CLP_Notifications', group: 'GHS' },
  { label: 'GHS Japan', value: 'GHS_Japan', group: 'GHS' },
  { label: 'GHS Australia', value: 'GHS_Australia', group: 'GHS' },
  { label: 'GHS Korea', value: 'GHS_Korea', group: 'GHS' },
  { label: 'GHS China', value: 'GHS_China', group: 'GHS' },
  { label: 'SIMDUT 2015', value: 'SIMDUT_2015', group: 'GHS' },
  { label: 'GHS Taiwan', value: 'GHS_Taiwan', group: 'GHS' },
  { label: 'GHS Malaysia', value: 'GHS_Malaysia', group: 'GHS' },
  { label: 'IARC/CIRC', value: 'IARC', group: 'Cancérogénicité' },
  { label: 'ACGIH', value: 'ACGIH', group: 'Cancérogénicité' },
  { label: 'USEPA Carcinogens', value: 'USEPA_Carcinogens', group: 'Cancérogénicité' },
  { label: 'MAK Carcinogens', value: 'MAK_Carcinogens', group: 'Cancérogénicité' },
  { label: 'NTP Carcinogens', value: 'NTP_Carcinogens', group: 'Cancérogénicité' },
  { label: 'OEHHA', value: 'OEHHA', group: 'Cancérogénicité' },
  { label: 'BKH-DHI', value: 'BKH_DHI', group: 'Perturbateurs endocriniens' },
  { label: 'DEDuCT', value: 'DEDuCT', group: 'Perturbateurs endocriniens' },
  { label: 'EU EDlists', value: 'EU_EDlists', group: 'Perturbateurs endocriniens' },
  { label: 'USEPA ED', value: 'USEPA_ED', group: 'Perturbateurs endocriniens' },
  { label: 'SINList', value: 'SINList', group: 'Perturbateurs endocriniens' },
  { label: 'TEDX', value: 'TEDX', group: 'Perturbateurs endocriniens' },
  { label: 'AOEC Asthmagens', value: 'AOEC_Asthmagens', group: 'Autres' },
  { label: 'FEMA', value: 'FEMA', group: 'Autres' },
  { label: 'HAZMAP', value: 'HAZMAP', group: 'Autres' },
  { label: 'MAK Allergens', value: 'MAK_Allergens', group: 'Autres' },
  { label: 'HPHC', value: 'HPHC', group: 'Autres' },
  { label: 'ATSDR Hazards', value: 'ATSDR_Hazards', group: 'Autres' },
];

export const GROUPS = [...new Set(SOURCES.map(s => s.group))];

export function getSourcesByGroup(group) {
  return SOURCES.filter(s => s.group === group);
}

export function getAllSourceValues() {
  return SOURCES.map(s => s.value);
}
