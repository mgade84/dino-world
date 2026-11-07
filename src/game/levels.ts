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
  | { kind: 'free'; n: number };

export interface LevelDef {
  id: string;
  name: Txt;
  /** Where on the island it takes place. */
  place: Txt;
  /** The mission briefing, read before the level starts. */
  brief: Txt;
  /** Every goal must be met to finish the level. */
  goals: Goal[];
  /** 'cage': start locked in the paddock; 'free': start just outside its broken bars. */
  start: 'cage' | 'free';
  /** Seconds to finish, or none. */
  timeLimit?: number;
  /** Park radio, shown as subtitles and spoken. */
  radio: { start: Txt; done: Txt; fail?: Txt; escaped?: Txt };
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
    radio: {
      start: { en: 'Security to all crews. Return to the visitor centre now.', da: 'Sikkerhed til alle hold. Vend tilbage til besøgscentret nu.' },
      done: { en: 'We have lost the east roads. Fall back to Main Street!', da: 'Vi har mistet østvejene. Træk jer tilbage til hovedgaden!' },
    },
    ready: true,
  },
  {
    id: 'mainstreet',
    name: { en: 'Main Street', da: 'Hovedgaden' },
    place: { en: 'Visitor centre', da: 'Besøgscentret' },
    brief: {
      en: 'Guests are being herded towards the visitor centre to wait out the storm. Halcyon keeps more animals in cages nearby. Break them out and empty the streets.',
      da: 'Gæsterne bliver ført hen til besøgscentret for at vente stormen af. Halcyon holder flere dyr i bure tæt ved. Bryd dem ud og tøm gaderne.',
    },
    goals: [{ kind: 'free', n: 2 }, { kind: 'scare', n: 10 }, { kind: 'smash', n: 4 }],
    start: 'free',
    radio: {
      start: { en: 'Attention, guests. Please remain calm and stay indoors.', da: 'Kære gæster. Bevar roen og bliv indendørs.' },
      done: { en: 'More animals are loose! Get everyone to the docks!', da: 'Flere dyr er sluppet løs! Få alle ned til havnen!' },
    },
    ready: true,
  },
  {
    id: 'power',
    name: { en: 'Blackout', da: 'Mørklagt' },
    place: { en: 'Power station', da: 'Kraftværket' },
    brief: {
      en: 'The backup generators keep every other paddock on the island locked. Destroy them and Kessick Island goes dark.',
      da: 'Nødgeneratorerne holder alle de andre indhegninger låst. Ødelæg dem, og Kessick Island bliver mørklagt.',
    },
    goals: [],
    start: 'free',
    radio: { start: { en: '', da: '' }, done: { en: '', da: '' } },
    ready: false,
  },
  {
    id: 'docks',
    name: { en: 'Last Boat', da: 'Sidste båd' },
    place: { en: 'The docks', da: 'Havnen' },
    brief: {
      en: 'The evacuation is under way and the last boats are leaving. Halcyon wants to take its animals with it. Stop them.',
      da: 'Evakueringen er i gang, og de sidste både sejler. Halcyon vil tage sine dyr med. Stop dem.',
    },
    goals: [],
    start: 'free',
    radio: { start: { en: '', da: '' }, done: { en: '', da: '' } },
    ready: false,
  },
];
