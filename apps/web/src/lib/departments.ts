'use client';

import { useCallback, useState } from 'react';

export interface DepartmentPosition { id: string; name: string; nameFr: string | null; staff: number }
export interface Department { id: string; name: string; nameFr: string | null; aquatic: boolean; positions: DepartmentPosition[]; managerRoleIds?: string[] }
/** A role that can manage departments; `builtin:aquatic` stands for the built-in aquatic leads. */
export interface ManagerOption { id: string; name: string; nameFr: string | null; builtIn: boolean; wholeCity: boolean }
export interface Departments { departments: Department[]; unassigned: DepartmentPosition[]; limited: boolean; managerOptions?: ManagerOption[] }
export const AQUATIC_MANAGERS = 'builtin:aquatic';

const KEY = 'fh-department-tab';

/** The department tab HR picked; shared by the people lists for this browser tab. '' = every department. */
export function useDepartmentTab(): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });
  const set = useCallback((v: string) => {
    setValue(v);
    try {
      sessionStorage.setItem(KEY, v);
    } catch {
      /* private mode */
    }
  }, []);
  return [value, set];
}

/** Query string for a list filtered to a department tab. */
export const departmentParam = (tab: string, first = false) => (tab ? `${first ? '?' : '&'}department=${encodeURIComponent(tab)}` : '');
