/**
 * The story: one T-Rex, Specimen T-07 ("Grimjaw"), breaking out of Halcyon Genetics' Primordia park
 * on Kessick Island during a tropical storm. Kept free of Three.js so scripts/voice can read the radio lines.
 */
import type { Txt } from '../i18n';
import type { DinoSpec } from './species';

export type Goal =
  | { kind: 'escape' }
  | { kind: 'smash'; n: number }
  | { kind: 'scare'; n: number }
  | { kind: 'free'; n: number }
  | { kind: 'destroy'; n: number }
  | { kind: 'generators'; n: number }
  | { kind: 'sink'; n: number };

type V3 = [number, number, number];

export interface LevelDef {
  id: string;
  name: Txt;
  /** Where on the island it takes place. */
  place: Txt;
  /** The mission briefing, read before the level starts. */
  brief: Txt;
  /** Every goal must be met to finish the level. */
  goals: Goal[];
  /** 'cage': start locked in the paddock; 'free': just outside its broken bars; or [x, z, heading]. */
  start: 'cage' | 'free' | V3;
  /** The opening shot: the camera glides from `from` to `to`, looking at `look`, under the level's title. */
  intro: { from: V3; to: V3; look: V3 };
  /** 'off': the blackout has happened (generators wrecked, lights out, paddocks already empty). */
  power?: 'on' | 'off';
  /** Seconds after the start at which each moored boat leaves the docks. */
  boats?: number[];
  /** Seconds to finish, or none. */
  timeLimit?: number;
  /** Rangers with tranquilliser rifles on the island. */
  rangers?: number;
  /** The perimeter fences: live (zap) or dead (can be torn down). Absent: no fences. */
  fences?: 'live' | 'dead';
  /** Park radio, shown as subtitles and spoken. `spotted` plays when a ranger first sees the dinosaur. */
  radio: { start: Txt; done: Txt; fail?: Txt; escaped?: Txt; spotted?: Txt };
  /** False for levels still being built: shown in the list, but locked. */
  ready: boolean;
}

/** The story's hero. Other species unlock for Rampage when freed. */
export const HERO: DinoSpec['id'] = 'trex';

export const LEVELS: LevelDef[] = [
  {
    id: 'paddock',
    name: { en: 'Containment', da: 'Indespærret' },
    place: { en: 'Paddock 7', da: 'Indhegning 7' },
    brief: {
      en: 'A tropical storm has knocked out the main power on Kessick Island. The fences around Paddock 7 are dead, but only until the backup generator starts. Specimen T-07 has waited long enough. Bite through the bars before the power comes back.',
      da: 'En tropisk storm har slået strømmen ud på Kessick Island. Hegnet om Indhegning 7 er dødt, men kun indtil nødgeneratoren starter. Eksemplar T-07 har ventet længe nok. Bid dig igennem tremmerne, før strømmen kommer tilbage.',
    },
    goals: [{ kind: 'escape' }],
    start: 'cage',
    intro: { from: [24, 11, -26], to: [11, 6, -15], look: [0, 3, 6] },
    timeLimit: 120,
    radio: {
      start: { en: 'Control to all units. Main power is down. Backup generator in two minutes.', da: 'Kontrol til alle enheder. Strømmen er gået. Nødgenerator om to minutter.' },
      escaped: { en: 'Paddock 7 is breached! The T-07 is loose!', da: 'Indhegning 7 er brudt! T-07 er sluppet løs!' },
      done: { en: 'Security, we have a containment breach. Get to the service roads!', da: 'Sikkerhed, vi har et udbrud. Kør ud på servicevejene!' },
      fail: { en: 'Backup power is online. Paddock 7 is sealed.', da: 'Nødstrømmen er tilbage. Indhegning 7 er lukket.' },
    },
    ready: true,
  },
  {
    id: 'roads',
    name: { en: 'Service Roads', da: 'Servicevejene' },
    place: { en: 'East jungle', da: 'Østjunglen' },
    brief: {
      en: 'Work crews are pulling out of the jungle before the storm hits, and security jeeps are patrolling the service roads. Wreck the jeeps and send the crews running.',
      da: 'Arbejdsholdene trækker sig ud af junglen, før stormen rammer, og sikkerhedsjeeps patruljerer servicevejene. Smadr jeepene og jag holdene på flugt.',
    },
    goals: [{ kind: 'smash', n: 6 }, { kind: 'scare', n: 8 }],
    start: 'free',
    intro: { from: [-18, 16, -42], to: [2, 9, -26], look: [0, 3, 6] },
    rangers: 3,
    fences: 'live',
    radio: {
      start: { en: 'Security to all crews. Return to the visitor centre now.', da: 'Sikkerhed til alle hold. Vend tilbage til besøgscentret nu.' },
      spotted: { en: 'Ranger team, target in sight. Darts only. Take the shot!', da: 'Vagthold, målet er i sigte. Kun pile. Skyd!' },
      done: { en: 'We have lost the east roads. Fall back to Main Street!', da: 'Vi har mistet østvejene. Træk jer tilbage til hovedgaden!' },
    },
    ready: true,
  },
  {
    id: 'mainstreet',
    name: { en: 'Main Street', da: 'Hovedgaden' },
    place: { en: 'Visitor centre', da: 'Besøgscentret' },
    brief: {
      en: 'Guests are being herded to Main Street, west of the paddocks, to wait out the storm. Halcyon keeps more animals in cages nearby. Break them out, bring the buildings down and empty the streets.',
      da: 'Gæsterne bliver ført hen til hovedgaden, vest for indhegningerne, for at vente stormen af. Halcyon holder flere dyr i bure tæt ved. Bryd dem ud, vælt bygningerne og tøm gaderne.',
    },
    goals: [{ kind: 'free', n: 2 }, { kind: 'destroy', n: 3 }, { kind: 'scare', n: 10 }, { kind: 'smash', n: 4 }],
    start: [-38, 78, -Math.PI / 2],
    intro: { from: [-30, 13, 92], to: [-46, 7, 84], look: [-75, 4, 80] },
    rangers: 5,
    fences: 'live',
    radio: {
      start: { en: 'Attention, guests. Please remain calm and stay indoors.', da: 'Kære gæster. Bevar roen og bliv indendørs.' },
      spotted: { en: 'All rangers to Main Street. Bring it down, but do not kill it!', da: 'Alle vagter til hovedgaden. Bedøv den, men dræb den ikke!' },
      done: { en: 'More animals are loose! Get everyone to the docks!', da: 'Flere dyr er sluppet løs! Få alle ned til havnen!' },
    },
    ready: true,
  },
  {
    id: 'power',
    name: { en: 'Blackout', da: 'Mørklagt' },
    place: { en: 'Power station', da: 'Kraftværket' },
    brief: {
      en: 'The backup generators keep every other paddock on the island locked. Destroy all three and Kessick Island goes dark. The station yard is fenced, and the fence is live: find the gate.',
      da: 'Nødgeneratorerne holder alle de andre indhegninger låst. Ødelæg alle tre, og Kessick Island bliver mørklagt. Kraftværkets gård er indhegnet, og hegnet er strømførende: find porten.',
    },
    goals: [{ kind: 'generators', n: 3 }],
    start: [-58, -25, -Math.PI / 2],
    intro: { from: [-62, 15, -6], to: [-74, 9, -16], look: [-95, 3, -25] },
    rangers: 4,
    fences: 'live',
    radio: {
      start: { en: 'Station crew, keep those generators running. Whatever happens.', da: 'Kraftværkets hold, hold generatorerne kørende. Uanset hvad.' },
      spotted: { en: 'It is at the power station! Stop it before it reaches the generators!', da: 'Den er ved kraftværket! Stop den, før den når generatorerne!' },
      done: { en: 'We have lost all power. Every paddock on the island is open!', da: 'Vi har mistet al strøm. Alle indhegninger på øen er åbne!' },
    },
    ready: true,
  },
  {
    id: 'docks',
    name: { en: 'Last Boat', da: 'Sidste båd' },
    place: { en: 'The docks', da: 'Havnen' },
    brief: {
      en: 'The evacuation is under way and Halcyon wants to take its animals with it. The boats leave the north docks on a schedule and sail along the coast. Wade out and capsize them before they get away.',
      da: 'Evakueringen er i gang, og Halcyon vil tage sine dyr med. Bådene sejler fra havnen i nord efter en fast plan og følger kysten. Gå ud i vandet og kæntr dem, før de slipper væk.',
    },
    goals: [{ kind: 'sink', n: 3 }, { kind: 'scare', n: 6 }],
    start: [15, 74, 0],
    intro: { from: [58, 13, 92], to: [42, 7, 100], look: [25, 1, 114] },
    rangers: 5,
    fences: 'dead',
    power: 'off',
    boats: [14, 34, 54, 74],
    radio: {
      start: { en: 'This is the final evacuation. Boats leave on schedule. No exceptions.', da: 'Dette er den sidste evakuering. Bådene sejler til tiden. Ingen undtagelser.' },
      spotted: { en: 'It followed us to the docks! Get those boats out!', da: 'Den er fulgt efter os til havnen! Få bådene ud!' },
      done: { en: 'It is over. Nobody is leaving Kessick Island tonight.', da: 'Det er slut. Ingen forlader Kessick Island i nat.' },
      fail: { en: 'The last boat is clear of the island.', da: 'Den sidste båd er sluppet væk fra øen.' },
    },
    ready: true,
  },
];
