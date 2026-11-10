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
  applyUrl: string;
  published?: boolean;
  postedOn?: string;
  province?: string | null;
}

export const jobTitle = (j: Job, lng: string) => (lng === 'fr-CA' && j.titleFr ? j.titleFr : j.title);
export const jobDescription = (j: Job, lng: string) => (lng === 'fr-CA' && j.descriptionFr ? j.descriptionFr : j.description);
