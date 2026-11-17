'use strict';

/* =====================================================================
   Calendário oficial da Fórmula 1 — temporada 2027 (24 etapas).

   Fonte: calendário divulgado pela F1/FIA em 16/09/2026.
   O campo "sprint" indica as etapas com formato sprint em 2027.
   A ordem do array é a ordem oficial do campeonato.
===================================================================== */

const F1_CALENDAR = [
  { id: 'bahrain',        name: 'GP do Bahrein',          country: 'Bahrein',                 flag: '🇧🇭', circuit: 'Bahrain International Circuit',     city: 'Sakhir',       sprint: true  },
  { id: 'saudi-arabia',   name: 'GP da Arábia Saudita',   country: 'Arábia Saudita',          flag: '🇸🇦', circuit: 'Jeddah Corniche Circuit',           city: 'Jeddah',       sprint: false },
  { id: 'australia',      name: 'GP da Austrália',        country: 'Austrália',               flag: '🇦🇺', circuit: 'Albert Park Circuit',               city: 'Melbourne',    sprint: true  },
  { id: 'japan',          name: 'GP do Japão',            country: 'Japão',                   flag: '🇯🇵', circuit: 'Suzuka Circuit',                    city: 'Suzuka',       sprint: true  },
  { id: 'china',          name: 'GP da China',            country: 'China',                   flag: '🇨🇳', circuit: 'Shanghai International Circuit',    city: 'Xangai',       sprint: false },
  { id: 'miami',          name: 'GP de Miami',            country: 'Estados Unidos',          flag: '🇺🇸', circuit: 'Miami International Autodrome',     city: 'Miami',        sprint: false },
  { id: 'canada',         name: 'GP do Canadá',           country: 'Canadá',                  flag: '🇨🇦', circuit: 'Circuit Gilles Villeneuve',         city: 'Montreal',     sprint: true  },
  { id: 'monaco',         name: 'GP de Mônaco',           country: 'Mônaco',                  flag: '🇲🇨', circuit: 'Circuit de Monaco',                 city: 'Monte Carlo',  sprint: true  },
  { id: 'portugal',       name: 'GP de Portugal',         country: 'Portugal',                flag: '🇵🇹', circuit: 'Autódromo Internacional do Algarve', city: 'Portimão',    sprint: false },
  { id: 'great-britain',  name: 'GP da Grã-Bretanha',     country: 'Grã-Bretanha',            flag: '🇬🇧', circuit: 'Silverstone Circuit',               city: 'Silverstone',  sprint: true  },
  { id: 'austria',        name: 'GP da Áustria',          country: 'Áustria',                 flag: '🇦🇹', circuit: 'Red Bull Ring',                     city: 'Spielberg',    sprint: false },
  { id: 'belgium',        name: 'GP da Bélgica',          country: 'Bélgica',                 flag: '🇧🇪', circuit: 'Circuit de Spa-Francorchamps',      city: 'Stavelot',     sprint: false },
  { id: 'hungary',        name: 'GP da Hungria',          country: 'Hungria',                 flag: '🇭🇺', circuit: 'Hungaroring',                       city: 'Mogyoród',     sprint: false },
  { id: 'italy',          name: 'GP da Itália',           country: 'Itália',                  flag: '🇮🇹', circuit: 'Monza Circuit',                     city: 'Monza',        sprint: true  },
  { id: 'spain',          name: 'GP de Espanha',          country: 'Espanha',                 flag: '🇪🇸', circuit: 'Madring',                           city: 'Madrid',       sprint: false },
  { id: 'azerbaijan',     name: 'GP do Azerbaijão',       country: 'Azerbaijão',              flag: '🇦🇿', circuit: 'Baku City Circuit',                 city: 'Baku',         sprint: false },
  { id: 'turkey',         name: 'GP da Turquia',          country: 'Turquia',                 flag: '🇹🇷', circuit: 'Istanbul Park',                     city: 'Istambul',     sprint: false },
  { id: 'singapore',      name: 'GP de Singapura',        country: 'Singapura',               flag: '🇸🇬', circuit: 'Marina Bay Street Circuit',         city: 'Singapura',    sprint: false },
  { id: 'united-states',  name: 'GP dos Estados Unidos',  country: 'Estados Unidos',          flag: '🇺🇸', circuit: 'Circuit of the Americas',           city: 'Austin',       sprint: false },
  { id: 'mexico',         name: 'GP da Cidade do México', country: 'México',                  flag: '🇲🇽', circuit: 'Autódromo Hermanos Rodríguez',      city: 'Cidade do México', sprint: false },
  { id: 'brazil',         name: 'GP de São Paulo',        country: 'Brasil',                  flag: '🇧🇷', circuit: 'Interlagos Circuit',                city: 'São Paulo',    sprint: true  },
  { id: 'las-vegas',      name: 'GP de Las Vegas',        country: 'Estados Unidos',          flag: '🇺🇸', circuit: 'Las Vegas Strip Circuit',           city: 'Las Vegas',    sprint: false },
  { id: 'qatar',          name: 'GP do Catar',            country: 'Catar',                   flag: '🇶🇦', circuit: 'Lusail International Circuit',      city: 'Lusail',       sprint: true  },
  { id: 'abu-dhabi',      name: 'GP de Abu Dhabi',        country: 'Emirados Árabes Unidos',  flag: '🇦🇪', circuit: 'Yas Marina Circuit',                city: 'Abu Dhabi',    sprint: true  },
];

module.exports = { F1_CALENDAR };
