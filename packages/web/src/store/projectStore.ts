/** 项目切片：项目列表、信任状态、当前项目（T02 经 host REST 填充） */
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import type { Project } from '@pi-agent/shared';

export interface ProjectSlice {
  projects: Project[];
  currentProjectId: string | null;
  setCurrentProject(projectId: string | null): void;
  upsertProject(project: Project): void;
  removeProject(projectId: string): void;
}

export const createProjectSlice: StateCreator<
  AppState,
  [],
  [],
  ProjectSlice
> = (set) => ({
  projects: [],
  currentProjectId: null,

  setCurrentProject(projectId: string | null): void {
    set({ currentProjectId: projectId });
  },
  upsertProject(project: Project): void {
    set((s) => {
      const exists = s.projects.some((item) => item.id === project.id);
      return {
        projects: exists
          ? s.projects.map((item) => (item.id === project.id ? project : item))
          : [...s.projects, project],
      };
    });
  },
  removeProject(projectId: string): void {
    set((s) => ({
      projects: s.projects.filter((item) => item.id !== projectId),
      currentProjectId: s.currentProjectId === projectId ? null : s.currentProjectId,
    }));
  },
});
