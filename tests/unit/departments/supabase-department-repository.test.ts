import { SupabaseDepartmentRepository } from "@/modules/departments/repositories/SupabaseDepartmentRepository";

const mockGetServiceRoleSupabaseClient = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

type DepartmentQueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type UsersQueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type DepartmentBuilder = {
  select: jest.Mock<DepartmentBuilder, unknown[]>;
  eq: jest.Mock<DepartmentBuilder, unknown[]>;
  order: jest.Mock<Promise<DepartmentQueryResult>, unknown[]>;
};

type UsersBuilder = {
  select: jest.Mock<UsersBuilder, unknown[]>;
  in: jest.Mock<Promise<UsersQueryResult>, unknown[]>;
};

function createDepartmentBuilder(result: DepartmentQueryResult) {
  const builder = {} as DepartmentBuilder;

  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.order = jest.fn(async () => result);

  return builder;
}

function createUsersBuilder(result: UsersQueryResult) {
  const builder = {} as UsersBuilder;

  builder.select = jest.fn(() => builder);
  builder.in = jest.fn(async () => result);

  return builder;
}

describe("SupabaseDepartmentRepository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns error when departments fetch fails", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: null,
      error: { message: "departments failed" },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return createUsersBuilder({ data: [], error: null });
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result).toEqual({
      data: [],
      errorMessage: "departments failed",
    });
  });

  test("returns empty data when no approver IDs exist", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: [
        {
          id: "dep-1",
          name: "Engineering",
          is_active: true,
          hod_user_id: null,
          founder_user_id: null,
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return createUsersBuilder({ data: [], error: null });
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result).toEqual({
      data: [],
      errorMessage: null,
    });
  });

  test("returns error when user lookup fails", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: [
        {
          id: "dep-1",
          name: "Engineering",
          is_active: true,
          hod_user_id: "u-hod",
          founder_user_id: "u-founder",
        },
      ],
      error: null,
    });

    const usersBuilder = createUsersBuilder({
      data: null,
      error: { message: "users failed" },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return usersBuilder;
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result).toEqual({
      data: [],
      errorMessage: "users failed",
    });
  });

  test("maps only departments with both hod and founder users", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: [
        {
          id: "dep-1",
          name: "Engineering",
          is_active: true,
          hod_user_id: "u-hod-1",
          founder_user_id: "u-founder-1",
        },
        {
          id: "dep-2",
          name: "Marketing",
          is_active: true,
          hod_user_id: "u-hod-2",
          founder_user_id: "u-founder-2",
        },
      ],
      error: null,
    });

    const usersBuilder = createUsersBuilder({
      data: [
        {
          id: "u-hod-1",
          email: "hod1@nxtwave.co.in",
          full_name: "HOD One",
          is_active: true,
        },
        {
          id: "u-founder-1",
          email: "founder1@nxtwave.co.in",
          full_name: "Founder One",
          is_active: true,
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return usersBuilder;
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      {
        id: "dep-1",
        name: "Engineering",
        isActive: true,
        hod: {
          id: "u-hod-1",
          email: "hod1@nxtwave.co.in",
          fullName: "HOD One",
          isActive: true,
        },
        founder: {
          id: "u-founder-1",
          email: "founder1@nxtwave.co.in",
          fullName: "Founder One",
          isActive: true,
        },
      },
    ]);
  });
});
