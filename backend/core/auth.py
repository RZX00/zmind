from fastapi import HTTPException, Depends, Security, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from core.services.supabase import DBConnection
from core.utils.logger import logger

security = HTTPBearer()

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    from core.utils.auth_utils import verify_and_get_user_id_from_jwt
    try:
        user_id = await verify_and_get_user_id_from_jwt(request)
        return {"user_id": user_id, "token": credentials.credentials}
    except Exception as e:
        logger.error(f"Auth failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid authentication")

def verify_role(required_role: str):
    async def role_checker(user: dict = Depends(get_current_user)) -> dict:
        db = DBConnection()
        client = await db.client
        result = await client.table('user_roles').select('role').eq('user_id', user['user_id']).execute()
        
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=403, detail="No role assigned")

        roles = [row.get('role') for row in result.data if row.get('role')]
        if not roles:
            raise HTTPException(status_code=403, detail="No role assigned")

        role_hierarchy = {'user': 0, 'admin': 1, 'super_admin': 2}
        required_level = role_hierarchy.get(required_role, 999)
        max_level = max(role_hierarchy.get(role, -1) for role in roles)

        if max_level < required_level:
            raise HTTPException(status_code=403, detail=f"Requires {required_role} role")

        # Pick the highest role for context
        user_role = max(roles, key=lambda role: role_hierarchy.get(role, -1))
        user['role'] = user_role
        return user
    
    return role_checker

require_admin = verify_role('admin')
require_super_admin = verify_role('super_admin') 
