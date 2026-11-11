export interface Job {
  id: string;
  title: string;
  titleFr: string | null;
  description: string;
  descriptionFr: string | null;
  facilityId: string | null;
  facility: string | null;
  employmentStatus: string;
  payMin: string | null;
  payMax: string | null;
  closesOn: string;
  applyUrl: string | null;
  /** Applications go through the careers page into FH. */
  applyInApp?: boolean;
  published?: boolean;
  postedOn?: string;
  province?: string | null;
  /** Public postings: working age for the age question (see the API's services/legal/ages.ts). */
  workAge?: WorkAge;
}

export interface WorkAge { province: string | null; adultAge: number; minAge: number; link: string | null }

export const jobTitle = (j: Job, lng: string) => (lng === 'fr-CA' && j.titleFr ? j.titleFr : j.title);
export const jobDescription = (j: Job, lng: string) => (lng === 'fr-CA' && j.descriptionFr ? j.descriptionFr : j.description);
