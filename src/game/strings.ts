import { L, type Lang } from '../../i18n';

const en = {
  loading: 'Loading the jungle…',
  loadFailed: 'Could not load the jungle.',
  pick: 'Pick your dinosaur!',
  escapeHint: 'Bite the bars to get out!',
  escaped: 'You are free! Smash the cars and scare the people!',
  cars: 'Cars smashed',
  people: 'People scared',
  freedLabel: 'Dinosaurs freed',
  freed: (name: string) => `You freed a ${name}!`,
  roar: 'Roar',
  bite: 'Bite',
  jump: 'Jump',
  fly: 'Fly (hold)',
  flyHint: 'Hold the button to fly!',
  change: 'Pick another dinosaur',
  done: 'You did it!',
  doneSub: (n: number) => `${n} 🚙 · ${n} 🏃`,
};

export const M: Record<Lang, typeof en> = {
  en,
  da: {
    loading: 'Henter junglen…',
    loadFailed: 'Junglen kunne ikke hentes.',
    pick: 'Vælg din dinosaur!',
    escapeHint: 'Bid i tremmerne for at komme ud!',
    escaped: 'Du er fri! Smadr bilerne og skræm folkene!',
    cars: 'Smadrede biler',
    people: 'Skræmte mennesker',
    freedLabel: 'Befriede dinosaurer',
    freed: (name: string) => `Du har befriet en ${name}!`,
    roar: 'Brøl',
    bite: 'Bid',
    jump: 'Hop',
    fly: 'Flyv (hold nede)',
    flyHint: 'Hold knappen nede for at flyve!',
    change: 'Vælg en anden dinosaur',
    done: 'Du klarede det!',
    doneSub: (n: number) => `${n} 🚙 · ${n} 🏃`,
  },
};

export const S = () => L(M);
