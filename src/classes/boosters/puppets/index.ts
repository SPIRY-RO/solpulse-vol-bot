import PuppetBase from './base';

export { default as PuppetVolume } from './volume';
export { default as PuppetRank } from './rank';

export const activePuppets: { [x: string]: PuppetBase } = {};
