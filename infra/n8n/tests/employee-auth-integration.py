"""Real Auth/PostgREST acceptance test, ONLY against an isolated schema clone.

Requires TEST_AUTH_URL, TEST_REST_URL, TEST_SERVICE_KEY and TEST_MAIL_JSON.
SMTP must be a local capture server. The marker table below must exist only in
the disposable test database; production endpoints are refused before writes.
Never print the captured email, passwords, JWTs, or activation links.
"""
import hashlib
import html
import json
import os
from pathlib import Path
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


auth = os.environ['TEST_AUTH_URL']
rest = os.environ['TEST_REST_URL']
service = os.environ['TEST_SERVICE_KEY']
opener = urllib.request.build_opener(NoRedirect)


def call(base, path, method='GET', body=None, token=None, allowed=(200,)):
    request = urllib.request.Request(
        base + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={'Content-Type': 'application/json', **(
            {'Authorization': 'Bearer ' + token} if token else {})},
    )
    try:
        response = opener.open(request, timeout=20)
        status, raw, headers = response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        status, raw, headers = error.code, error.read(), error.headers
    if status not in allowed:
        # Do not include URLs with query tokens or server error row details.
        raise RuntimeError('Unexpected HTTP ' + str(status) + ' at ' + path.split('?')[0])
    return (json.loads(raw) if raw and status < 300 else None), headers


marker, _ = call(rest, '/employee_auth_test_marker?select=id', token=service)
assert marker == [{'id': 1}], 'Refusing to mutate an environment without the test marker'
suffix = secrets.token_hex(5)
owner_email = 'owner+' + suffix + '@employee-test.local'
employee_email = 'employee+' + suffix + '@employee-test.local'
password = secrets.token_urlsafe(32)
call(auth, '/admin/users', 'POST', {
    'email': owner_email, 'password': password, 'email_confirm': True,
    'user_metadata': {'full_name': 'Isolated owner ' + suffix},
}, service)
login, _ = call(auth, '/token?grant_type=password', 'POST', {
    'email': owner_email, 'password': password,
})
owner_jwt = login['access_token']
accounts, _ = call(rest, '/accounts?select=id', token=owner_jwt)
assert len(accounts) == 1
before, _ = call(rest, '/accounts?select=id', token=service)
business = accounts[0]['id']
call(rest, '/rpc/ops_command', 'POST', {
    'p_account': business, 'p_action': 'configure',
    'p_payload': {'primary_activity': 'services', 'additional_activities': [],
                  'timezone': 'UTC', 'professional_label': 'Professional',
                  'disabled_modules': [], 'public_enabled': False},
    'p_request_id': str(uuid.uuid4()),
}, owner_jwt)
app_token = secrets.token_urlsafe(32)
token_hash = hashlib.sha256(app_token.encode()).hexdigest()
saved, _ = call(rest, '/rpc/ops_employee_save', 'POST', {
    'p_account': business,
    'p_payload': {'name': 'Isolated employee', 'hours': [], 'service_bps': 3000, 'product_bps': 1000},
    'p_access': {'mode': 'save', 'email': employee_email, 'modules': ['appointments']},
    'p_request': str(uuid.uuid4()), 'p_hash': token_hash,
}, owner_jwt)
professional, access = saved['professional']['id'], saved['access']
call(auth, '/admin/users', 'POST', {
    'id': access['provision_user_id'], 'email': employee_email, 'email_confirm': False,
}, service)
after, _ = call(rest, '/accounts?select=id', token=service)
assert len(before) == len(after), 'Employee creation made an unwanted personal business'

redirect = 'http://employee-test.local/employee/activate?token=' + app_token
call(auth, '/invite?redirect_to=' + urllib.parse.quote(redirect, safe=''), 'POST', {'email': employee_email}, service)
mail = json.loads(Path(os.environ['TEST_MAIL_JSON']).read_text())
assert mail['recipient'] == [employee_email]
links = [html.unescape(value) for part in mail['parts'] for value in re.findall(r'https?://[^\s"<>]+', part)]
parsed = urllib.parse.urlsplit(next(value for value in links if '/verify?' in value))
# Follow verification only against the isolated Auth endpoint, not the email URL.
verification_path = parsed.path[8:] if parsed.path.startswith('/auth/v1/') else parsed.path
_, headers = call(auth, verification_path + '?' + parsed.query, allowed=(302, 303))
location = urllib.parse.urlsplit(headers['Location'])
assert location.path == '/employee/activate'
assert urllib.parse.parse_qs(location.query)['token'][0] == app_token
fragment = urllib.parse.parse_qs(location.fragment)
employee_jwt = fragment['access_token'][0]
assert fragment['type'][0] == 'invite'
user, _ = call(auth, '/user', token=employee_jwt)
assert user.get('email_confirmed_at')
call(auth, '/user', 'PUT', {'password': secrets.token_urlsafe(20), 'data': {'employee_password_set': True}}, employee_jwt)
accepted, _ = call(rest, '/rpc/ops_employee_accept', 'POST', {'p_hash': token_hash}, employee_jwt)
assert accepted == business
profile, _ = call(rest, '/profiles?select=account_role', token=employee_jwt)
assert profile[0]['account_role'] == 'professional'
dashboard, _ = call(rest, '/rpc/ops_dashboard', 'POST', {'p_account': business}, employee_jwt)
assert dashboard['allowed_modules'] == ['appointments'] and dashboard['commissions'] == [] and dashboard['operations'] == []
call(rest, '/rpc/ops_command', 'POST', {
    'p_account': business, 'p_action': 'close', 'p_payload': {}, 'p_request_id': str(uuid.uuid4()),
}, employee_jwt, allowed=(403,))
call(rest, '/rpc/ops_employee_prepare', 'POST', {
    'p_account': business, 'p_professional': professional, 'p_email': employee_email,
    'p_modules': ['appointments', 'commissions'], 'p_mode': 'save', 'p_hash': token_hash, 'p_request': str(uuid.uuid4()),
}, owner_jwt)
dashboard, _ = call(rest, '/rpc/ops_dashboard', 'POST', {'p_account': business}, employee_jwt)
assert dashboard['allowed_modules'] == ['appointments', 'commissions']
call(rest, '/rpc/ops_employee_prepare', 'POST', {
    'p_account': business, 'p_professional': professional, 'p_email': None,
    'p_modules': None, 'p_mode': 'suspend', 'p_hash': None, 'p_request': str(uuid.uuid4()),
}, owner_jwt)
call(rest, '/rpc/ops_dashboard', 'POST', {'p_account': business}, employee_jwt, allowed=(403,))
print('Real Auth, captured SMTP, JWT, password setup, activation, editable modules and immediate suspension passed.')
