"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {useTranslations, useFormatter} from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { backendApi } from '@/lib/api-client';
import { Loader2, RefreshCcw, Sparkles, PlusCircle, Copy, Check, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFileToStorage } from '@/canvas/services/canvas-media.service';
import { getWechatQrAdmin, saveWechatQrAsset } from '@/lib/api/assets';

type Invite = {
  id: string;
  code: string;
  reward_amount?: number | null;
  max_redemptions: number;
  redeemed_count: number;
  active: boolean;
  expires_at?: string | null;
  campaign?: string | null;
  created_at?: string | null;
};

type Redemption = {
  id: string;
  code: string;
  account_id: string;
  email?: string | null;
  redeemed_at: string;
  reward_amount?: number | null;
  credit_expires_at?: string | null;
  campaign?: string | null;
};

type PublicAsset = {
  key: string;
  path: string;
  public_url: string;
  updated_at?: string;
  updated_by?: string;
};

const HIDDEN_CAMPAIGN = 'user_referral';

export default function InvitesAdminClient() {
  const t = useTranslations();
  const fmt = useFormatter();
  const [loading, setLoading] = useState(true);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [qrAsset, setQrAsset] = useState<PublicAsset | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrUploading, setQrUploading] = useState(false);
  const [showRedemptions, setShowRedemptions] = useState(false);

  const [form, setForm] = useState({
    count: 1,
    code: '',
    
    reward_amount: '',
    max_redemptions: 1,
    active: true,
    expires_in_days: 30,
    campaign: '',
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [inv, red] = await Promise.all([
        backendApi.get('/admin/billing/invites'),
        backendApi.get('/admin/billing/invites/redemptions'),
      ]);
      setInvites(inv.data || []);
      setRedemptions(red.data || []);
    } catch (e) {
      console.error('Failed to load invite data', e);
    } finally {
      setLoading(false);
    }
  };

  const loadQrAsset = async () => {
    try {
      setQrLoading(true);
      const res = await getWechatQrAdmin();
      setQrAsset(res || null);
    } catch (e) {
      console.error('Failed to load WeChat QR asset', e);
      setQrAsset(null);
    } finally {
      setQrLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    loadQrAsset();
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
    };
  }, []);

  const visibleInvites = useMemo(
    () => invites.filter((invite) => invite.campaign?.toLowerCase() !== HIDDEN_CAMPAIGN),
    [invites]
  );
  const visibleRedemptions = useMemo(
    () => redemptions.filter((redemption) => redemption.campaign?.toLowerCase() !== HIDDEN_CAMPAIGN),
    [redemptions]
  );

  const sortedInvites = useMemo(() => {
    return [...visibleInvites].sort((a, b) => {
      const aUsedUp = (a.redeemed_count || 0) >= (a.max_redemptions || 1);
      const bUsedUp = (b.redeemed_count || 0) >= (b.max_redemptions || 1);
      if (aUsedUp === bUsedUp) return 0;
      return aUsedUp ? 1 : -1;
    });
  }, [visibleInvites]);
  // Only show active/unused invites in the main table
  const displayedInvites = useMemo(() => {
    return sortedInvites.filter((i) => {
      const usedUp = (i.redeemed_count || 0) >= (i.max_redemptions || 1);
      const expired = i.expires_at ? new Date(i.expires_at).getTime() < Date.now() : false;
      return !usedUp && !expired;
    });
  }, [sortedInvites]);

  const handleCopyCode = async (code: string) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return;
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopiedCode(null), 2000);
    } catch (e) {
      console.error('Failed to copy invite code', e);
    }
  };

  const handleQrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('仅支持图片文件');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('图片需小于 2MB');
      return;
    }
    try {
      setQrUploading(true);
      const uploaded = await uploadFileToStorage(file, {
        bucket: 'file-uploads',
        pathPrefix: 'public/wechat-qr',
        makePublic: true,
      });
      const publicUrl = uploaded.downloadUrl || uploaded.fileUrl;
      if (!publicUrl || !publicUrl.startsWith('http')) {
        throw new Error('Failed to generate a public URL');
      }
      const saved = await saveWechatQrAsset({ path: uploaded.path, public_url: publicUrl });
      setQrAsset(saved);
      toast.success('微信群二维码已更新');
    } catch (err) {
      console.error('Failed to upload WeChat QR', err);
      toast.error('上传失败，请重试');
    } finally {
      setQrUploading(false);
    }
  };

  const handleCreate = async () => {
    try {
      setCreating(true);
      const payload: any = {
        count: Number(form.count) || 1,
        max_redemptions: Number(form.max_redemptions) || 1,
        active: !!form.active,
      };
      if (form.code.trim()) payload.code = form.code.trim();
      
      if (form.reward_amount.trim()) payload.reward_amount = Number(form.reward_amount);
      if (form.expires_in_days !== null && form.expires_in_days !== undefined) {
        payload.expires_in_days = Number(form.expires_in_days);
      }
      if (form.campaign.trim()) payload.campaign = form.campaign.trim();
      await backendApi.post('/admin/billing/invites', payload);
      await fetchAll();
    } catch (e) {
      console.error('Failed to create invite(s)', e);
    } finally {
      setCreating(false);
    }
  };

  const toggleDeleteMode = () => {
    setDeleteMode(!deleteMode);
    setSelectedIds([]);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(displayedInvites.map(i => i.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(selectedId => selectedId !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    // 立即关闭弹窗和退出删除模式
    setShowDeleteConfirm(false);
    const idsToDelete = [...selectedIds];
    setSelectedIds([]);
    setDeleteMode(false);
    
    try {
      await Promise.all(
        idsToDelete.map(id => backendApi.delete(`/admin/billing/invites/${id}`))
      );
      // 只在删除成功后更新本地状态，避免重新加载
      setInvites(prev => prev.filter(invite => !idsToDelete.includes(invite.id)));
    } catch (e) {
      console.error('Failed to delete invites', e);
      // 如果删除失败，重新加载数据以恢复正确状态
      await fetchAll();
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  // For display: exclude expired + used-up from total
  const totalInvites = useMemo(() => {
    return visibleInvites.filter((i) => {
      const usedUp = (i.redeemed_count || 0) >= (i.max_redemptions || 1);
      const expired = i.expires_at ? new Date(i.expires_at).getTime() < Date.now() : false;
      return !usedUp && !expired;
    }).length;
  }, [visibleInvites]);
  const totalRedemptions = visibleRedemptions.length;
  const totalUsedCodes = useMemo(
    () => visibleInvites.filter((i) => (i.redeemed_count || 0) >= (i.max_redemptions || 1)).length,
    [visibleInvites]
  );

  return (
    <div className="dashboard-page">
      <div className="dashboard-container-wide space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight dashboard-title">{t('admin.invites.title', {default: 'Invite Codes - Admin'})}</h1>
            <p className="text-md text-muted-foreground mt-2">{t('admin.invites.subtitle', {default: 'Generate and manage invite codes, and review redemption history.'})}</p>
            <div className="flex flex-wrap gap-2 mt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-background">
                总邀请码：{totalInvites}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-background">
                {t('admin.invites.totalRedemptions', {default: 'Total redemptions: {count}', count: totalRedemptions})}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={fetchAll} className="gap-2">
              <RefreshCcw className="h-4 w-4" /> {t('common.refresh', {default: 'Refresh'})}
            </Button>
        </div>
      </div>

        {/* WeChat QR asset */}
        <Card className="border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> 微信群二维码
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <div className="w-40 h-40 rounded-md border bg-muted/50 flex items-center justify-center overflow-hidden">
              {qrLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              ) : qrAsset?.public_url ? (
                <Image
                  src={qrAsset.public_url}
                  alt="WeChat QR"
                  width={160}
                  height={160}
                  unoptimized
                  loader={({ src }) => src}
                  className="w-full h-full object-contain"
                  onError={() => setQrAsset(qrAsset => qrAsset ? {...qrAsset, public_url: ''} : null)}
                />
              ) : (
                <div className="text-xs text-muted-foreground text-center px-2">暂无二维码</div>
              )}
            </div>
            <div className="flex-1 space-y-2 text-sm text-muted-foreground">
              <p>管理员上传后，激活页面会自动读取最新二维码，无需重新部署。</p>
              {qrAsset?.updated_at && (
                <div className="text-xs">上次更新：{fmt.dateTime(new Date(qrAsset.updated_at), {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleQrFileChange}
                />
                <Button onClick={() => fileInputRef.current?.click()} disabled={qrUploading} className="gap-2">
                  {qrUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {qrUploading ? '上传中...' : '上传/替换二维码'}
                </Button>
                <Button variant="outline" onClick={loadQrAsset} disabled={qrLoading} className="gap-2">
                  <RefreshCcw className="h-4 w-4" /> 重新拉取
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Create form */}
        <Card className="border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PlusCircle className="h-5 w-5" /> {t('admin.invites.createTitle', {default: 'Create Invite Codes'})}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm mb-1">{t('admin.invites.count', {default: 'Count'})}</label>
                <input type="number" min={1} max={500} value={form.count}
                  onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background" />
                <p className="text-xs text-muted-foreground mt-1">{t('admin.invites.countHint', {default: 'Generate multiple codes at once'})}</p>
              </div>
              <div>
                <label className="block text-sm mb-1">{t('admin.invites.expiresInDays', {default: 'Expires in (days)'})}</label>
                <input type="number" min={0} value={form.expires_in_days}
                  onChange={(e) => setForm({ ...form, expires_in_days: Number(e.target.value) })}
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="block text-sm mb-1">{t('admin.invites.tag', {default: 'Tag (optional)'})}</label>
                <input value={form.campaign}
                  onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                  placeholder="e.g. beta, launch, test"
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background" />
              </div>
            </div>

            {/* Advanced options - collapsed by default */}
            <details className="group">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                {t('admin.invites.advancedOptions', {default: 'Advanced options'})} ▼
              </summary>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm mb-1">{t('admin.invites.code', {default: '自定义邀请码（6位）'})}</label>
                    <input value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      placeholder={t('admin.invites.codePlaceholder', {default: 'Exact code (count must be 1)'})}
                      className="w-full rounded-md border px-3 py-2 text-sm bg-background" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">{t('admin.invites.reward', {default: 'Reward ($)'})}</label>
                    <input value={form.reward_amount}
                      onChange={(e) => setForm({ ...form, reward_amount: e.target.value })}
                      placeholder="Default 10"
                      className="w-full rounded-md border px-3 py-2 text-sm bg-background" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">{t('admin.invites.maxRedemptions', {default: 'Max Redemptions'})}</label>
                    <input type="number" min={1} value={form.max_redemptions}
                      onChange={(e) => setForm({ ...form, max_redemptions: Number(e.target.value) })}
                      className="w-full rounded-md border px-3 py-2 text-sm bg-background" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm">{t('admin.invites.active', {default: 'Active'})}</label>
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                </div>
              </div>
            </details>

            <div className="flex items-center gap-3 justify-end">
                <Button onClick={handleCreate} disabled={creating} className="gap-2">
                  {creating ? (<><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>) : (<><Sparkles className="h-4 w-4" /> Create</>)}
                </Button>
            </div>
          </CardContent>
        </Card>

        {/* Codes table */}
        <Card className="border">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-4">
              <CardTitle>Invite Codes</CardTitle>
              {deleteMode && selectedIds.length > 0 && (
                <span className="text-sm text-muted-foreground">{t('admin.invites.selectedCount', {default: 'Selected {count} invite codes', count: selectedIds.length})}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {deleteMode && selectedIds.length > 0 && (
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={handleBatchDelete}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('admin.invites.deleteSelected', {default: 'Delete Selected'})}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={toggleDeleteMode}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {deleteMode ? t('admin.invites.cancelDelete', {default: 'Cancel'}) : t('admin.invites.deleteMode', {default: 'Delete'})}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : visibleInvites.length === 0 ? (
              <div className="text-sm text-muted-foreground">No invite codes yet.</div>
            ) : displayedInvites.length === 0 ? (
              <div className="text-sm text-muted-foreground">当前没有可用的邀请码（已全部用完）。</div>
            ) : (
              <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        {deleteMode && (
                          <th className="text-left py-2 pr-3 w-12">
                            <input
                              type="checkbox"
                              checked={selectedIds.length === displayedInvites.length && displayedInvites.length > 0}
                              onChange={(e) => handleSelectAll(e.target.checked)}
                              className="rounded"
                            />
                          </th>
                        )}
                        <th className="text-left py-2 pr-3">Code</th>
                      <th className="text-left py-2 pr-3">Reward</th>
                      <th className="text-left py-2 pr-3">Usage</th>
                      <th className="text-left py-2 pr-3">Active</th>
                      <th className="text-left py-2 pr-3">Expires</th>
                      <th className="text-left py-2 pr-3">Tag</th>
                      <th className="text-left py-2 pr-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedInvites.map((i) => {
                      const redeemed = i.redeemed_count || 0;
                      const max = i.max_redemptions || 1;
                      const usedUp = redeemed >= max;
                      return (
                      <tr 
                        key={i.id} 
                        className={`border-b last:border-0 ${deleteMode ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                        onClick={() => deleteMode && handleSelectOne(i.id)}
                      >
                        {deleteMode && (
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(i.id)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => handleSelectOne(i.id)}
                              className="rounded"
                            />
                          </td>
                        )}
                        <td className="py-2 pr-3 min-w-[160px]">
                          <div className="flex items-center justify-between gap-2 group">
                            <span className="font-medium tracking-wide">{i.code}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyCode(i.code)}
                              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-opacity hover:bg-muted group-hover:opacity-100 opacity-0"
                              title={t('admin.invites.copy', {default: 'Copy code'})}
                              aria-label={t('admin.invites.copy', {default: 'Copy code'})}
                            >
                              {copiedCode === i.code ? (
                                <>
                                  <Check className="h-3.5 w-3.5" />
                                  <span>{t('common.copied', {default: 'Copied'})}</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>{t('common.copy', {default: 'Copy'})}</span>
                                </>
                              )}
                            </button>
                          </div>
                          {redeemed > 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {t('admin.invites.usedCount', {default: 'Already used {count}', count: redeemed})}
                              {usedUp && (
                                <span className="text-destructive ml-2">
                                  {t('admin.invites.usedUp', {default: 'Fully redeemed'})}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">{i.reward_amount != null ? `$${i.reward_amount.toFixed(2)}` : t('admin.invites.default', {default: 'Default'})}</td>
                        <td className="py-2 pr-3">{redeemed}/{max}</td>
                        <td className="py-2 pr-3">{i.active ? <Badge variant="secondary">{t('admin.invites.active', {default: 'Active'})}</Badge> : <Badge variant="outline">{t('admin.invites.inactive', {default: 'Inactive'})}</Badge>}</td>
                        <td className="py-2 pr-3">{i.expires_at ? new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric'}).format(new Date(i.expires_at)) : '—'}</td>
                        <td className="py-2 pr-3">{i.campaign || '—'}</td>
                        <td className="py-2 pr-3">{i.created_at ? new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(i.created_at)) : '—'}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Redemptions table */}
        <Card className="border">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              {t('admin.invites.redemptions', {default: 'Redemptions'})}
                      <span className="text-xs text-muted-foreground">({totalRedemptions})</span>            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => setShowRedemptions((v) => !v)}
            >
              {showRedemptions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {showRedemptions ? t('admin.invites.collapse', {default: 'Collapse'}) : t('admin.invites.expand', {default: 'Expand'})}
            </Button>
          </CardHeader>
          {showRedemptions && (
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : visibleRedemptions.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t('admin.invites.noRedemptions', {default: 'No redemptions yet.'})}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-2 pr-3">Code</th>
                        <th className="text-left py-2 pr-3">Email</th>
                        <th className="text-left py-2 pr-3">{t('admin.invites.account', {default: 'Account'})}</th>
                        <th className="text-left py-2 pr-3">{t('admin.invites.redeemed', {default: 'Redeemed'})}</th>
                        <th className="text-left py-2 pr-3">{t('admin.invites.reward', {default: 'Reward'})}</th>
                        <th className="text-left py-2 pr-3">{t('admin.invites.creditExpiry', {default: 'Credit Expiry'})}</th>
                        <th className="text-left py-2 pr-3">{t('admin.invites.tag', {default: 'Tag'})}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRedemptions.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">{r.code}</td>
                          <td className="py-2 pr-3">{r.email || '—'}</td>
                          <td className="py-2 pr-3">{r.account_id}</td>
                          <td className="py-2 pr-3">{fmt.dateTime(new Date(r.redeemed_at), {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</td>
                          <td className="py-2 pr-3">{r.reward_amount != null ? `$${r.reward_amount.toFixed(2)}` : '—'}</td>
                          <td className="py-2 pr-3">{r.credit_expires_at ? fmt.dateTime(new Date(r.credit_expires_at), {year:'numeric', month:'short', day:'numeric'}) : '—'}</td>
                          <td className="py-2 pr-3">{r.campaign || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('admin.invites.deleteMode', {default: 'Confirm Delete'})}</DialogTitle>
              <DialogDescription>
                {t('admin.invites.confirmDelete', {default: 'Are you sure you want to delete {count} invite codes? This action cannot be undone.', count: selectedIds.length})}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={cancelDelete}>
                {t('common.cancel', {default: 'Cancel'})}
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                {t('admin.invites.deleteSelected', {default: 'Delete Selected'})}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

