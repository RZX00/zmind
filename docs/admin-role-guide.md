# 管理员与超级管理员操作指引

该项目通过 Supabase 的 `public.user_roles` 表管理用户权限，枚举值包括 `user`、`admin` 和 `super_admin`。以下步骤说明如何查询目标用户的 UUID，并授予（或提升）其为管理员/超级管理员。

## 查询用户 UUID

1. 登录 Supabase 控制台，在 **Database → SQL Editor** 新建查询页面。
2. 使用以下语句查找用户的 UUID（支持模糊或精确匹配邮箱）：

   ```sql
   -- 列出最近创建的用户，便于浏览
   select id, email, created_at
   from auth.users
   order by created_at desc
   limit 20;

   -- 按邮箱精确查找目标用户
   select id
   from auth.users
   where email = 'user@example.com';
   ```

3. 如果使用 `psql` 或 Supabase CLI，同样可以运行上述 SQL。示例命令：

   ```bash
   psql "$SUPABASE_DB_URL" -c "select id, email from auth.users where email = 'user@example.com';"
   ```

记录返回的 `id`，后续授予权限时需要用到。

## 授予管理员或超级管理员角色

### 直接更新 `user_roles`

在 SQL Editor 或 `psql` 中执行以下语句即可新建/更新角色记录。`granted_by` 可填授予者的 UUID，也可以先写 `null`。

```sql
-- 赋予管理员 (admin) 角色
insert into public.user_roles (user_id, role, granted_by)
values ('<user_uuid>', 'admin', null)
on conflict (user_id) do update
  set role = excluded.role,
      granted_by = excluded.granted_by,
      granted_at = now();

-- 赋予超级管理员 (super_admin) 角色
insert into public.user_roles (user_id, role, granted_by)
values ('<user_uuid>', 'super_admin', null)
on conflict (user_id) do update
  set role = excluded.role,
      granted_by = excluded.granted_by,
      granted_at = now();
```

赋权后让用户重新登录（或刷新会话），前端会重新拉取角色信息，从而显示管理员相关页面。

### 使用 `grant_user_role` 函数（需已有超级管理员）

当系统里已经存在至少一名超级管理员时，可在其登录态下调用项目内置的函数，让授予流程更加安全：

```sql
select public.grant_user_role(
  target_user_id := '<user_uuid>',
  new_role := 'super_admin'  -- 可改为 'admin'
);
```

该函数会校验当前用户是否具备足够权限：只有超级管理员才能授予 `super_admin` 角色，管理员则仅能授予 `user` / `admin`。

### 验证当前角色

执行下面的查询确认角色是否生效：

```sql
select user_id, role, granted_at
from public.user_roles
where user_id = '<user_uuid>';
```

如需撤销权限，只需将 `role` 更新为 `user` 或删除对应记录。

---

**提示**：管理接口会根据 `require_admin` / `require_super_admin` 自动校验角色；如果用户仍然无法访问，请确认其访问的 API 使用的 token 是否与刚更新的账号一致。
