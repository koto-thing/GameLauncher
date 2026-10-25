"""ローカル実runtimeで確認リンク再発行と24時間を検証する"""
import unittest,uuid
import applicant_runtime_test as applicants
from applicant_runtime_test import request,mail
from lifecycle_runtime_test import clock
class AuthClockRuntime(unittest.TestCase):
 def tearDown(self):clock('real')
 def test_reissued_link_revoked_and_session_exactly_24_hours(self):
  # 実時刻に近い固定時計にして他の開催回の進行を避ける
  clock('2026-10-25T12:00:00.000Z');email=uuid.uuid4().hex+'@example.invalid'
  self.assertEqual(request('/api/lt/v1/auth/email',{'email':email})[0],202);old=mail(email).split('token=')[1]
  self.assertEqual(request('/api/lt/v1/auth/email',{'email':email})[0],202);new=mail(email).split('token=')[1]
  self.assertNotEqual(old,new);self.assertEqual(request('/api/lt/v1/auth/verify',{'token':old})[0],400)
  status,session,headers=request('/api/lt/v1/auth/verify',{'token':new});self.assertEqual(status,200);self.assertEqual(session['expiresAt'],'2026-10-26T12:00:00.000Z')
  cookie=headers['Set-Cookie'].split(';')[0]
  # 使用済みリンク由来sessionは再発行で失効しない
  self.assertEqual(request('/api/lt/v1/auth/email',{'email':email})[0],202)
  clock('2026-10-26T11:59:59.999Z');self.assertIsNotNone(request('/api/lt/v1/auth/session',cookie=cookie)[1])
  clock('2026-10-26T12:00:00.000Z');self.assertIsNone(request('/api/lt/v1/auth/session',cookie=cookie)[1])
 def test_link_exact_one_hour_boundary(self):
  clock('2026-10-25T12:00:00.000Z');email=uuid.uuid4().hex+'@example.invalid'
  request('/api/lt/v1/auth/email',{'email':email});token=mail(email).split('token=')[1]
  clock('2026-10-25T13:00:00.000Z');self.assertEqual(request('/api/lt/v1/auth/verify',{'token':token})[0],400)
if __name__=='__main__':unittest.main()
