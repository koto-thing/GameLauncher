import copy,json,unittest
from pathlib import Path
from jsonschema import Draft202012Validator,FormatChecker
ROOT=Path(__file__).parent
class EmailChangeContracts(unittest.TestCase):
    def validator(self,name):
        schema=json.loads((ROOT/'dto.schema.json').read_text(encoding='utf-8'));schema['$ref']='#/$defs/'+name
        return Draft202012Validator(schema,format_checker=FormatChecker())
    def test_manual_check_required_and_bounded(self):
        value={'expectedVersion':1,'operationId':'fixture','data':{'newEmail':'new@example.invalid','identityChecked':True,'identityCheckMethod':'既存窓口との照合','identityCheckResult':'confirmed'}}
        v=self.validator('InvestigateEmailInput');v.validate(value)
        for key,invalid in [('identityChecked',False),('identityCheckMethod',' '*3),('identityCheckMethod','x'*81),('identityCheckResult','unchecked')]:
            candidate=copy.deepcopy(value);candidate['data'][key]=invalid;self.assertFalse(v.is_valid(candidate))
        for key in ['identityChecked','identityCheckMethod','identityCheckResult']:
            candidate=copy.deepcopy(value);del candidate['data'][key];self.assertFalse(v.is_valid(candidate))
    def test_public_verification_cannot_request_session_or_identity(self):
        v=self.validator('EmailChangeVerificationInput');v.validate({'token':'fixture'})
        for key in ['email','role','applicationId','session']:
            self.assertFalse(v.is_valid({'token':'fixture',key:'forged'}))
        self.assertFalse(self.validator('EmailAccepted').is_valid({'accepted':True,'expiresAt':'2040-01-01T00:00:00.000Z'}))
    def test_action_versions_remain_mandatory(self):
        v=self.validator('EmailChangeActionInput');value={'expectedVersion':1,'operationId':'fixture','data':{'requestId':'request','expectedRequestVersion':1}};v.validate(value)
        del value['data']['expectedRequestVersion'];self.assertFalse(v.is_valid(value))
if __name__=='__main__':unittest.main()
