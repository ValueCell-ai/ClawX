import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ProjectFolder = 'main' | 'projects' | 'agl';

export type Project = {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  folder: ProjectFolder;
};

type ProjectState = {
  projects: Project[];
  activeProjectId: string | null;
  addProject: (name: string, folder?: ProjectFolder) => void;
  setActiveProject: (id: string | null) => void;
  toggleProjectAgent: (projectId: string, agentId: string) => void;
  renameProject: (id: string, newName: string) => void;
  moveProject: (id: string, folder: ProjectFolder) => void;
  deleteProject: (id: string) => void;
};

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,
      addProject: (name, folder = 'projects') =>
        set((state) => ({
          projects: [
            ...state.projects,
            {
              id: crypto.randomUUID(),
              name,
              agentIds: [],
              createdAt: Date.now(),
              folder,
            }
          ]
        })),
      setActiveProject: (id) => set({ activeProjectId: id }),
      toggleProjectAgent: (projectId, agentId) => set(state => ({
        projects: state.projects.map(p => {
          if (p.id !== projectId) return p;
          const agentIds = p.agentIds.includes(agentId)
            ? p.agentIds.filter(id => id !== agentId)
            : [...p.agentIds, agentId];
          return { ...p, agentIds };
        })
      })),
      renameProject: (id, newName) => set((state) => ({
        projects: state.projects.map(p => p.id === id ? { ...p, name: newName } : p)
      })),
      moveProject: (id, folder) => set((state) => ({
        projects: state.projects.map(p => p.id === id ? { ...p, folder } : p)
      })),
      deleteProject: (id) => set((state) => ({
        projects: state.projects.filter(p => p.id !== id),
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId
      }))
    }),
    {
      name: "clawx-projects",
      merge: (persisted, current) => {
        const typed = persisted as Partial<ProjectState> | undefined;
        const migratedProjects = (typed?.projects ?? current.projects).map((project) => ({
          ...project,
          folder: project.folder ?? 'projects',
        }));
        return {
          ...current,
          ...typed,
          projects: migratedProjects,
        };
      },
    }
  )
);
