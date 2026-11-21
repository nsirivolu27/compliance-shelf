const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const get = (name, field) => ({ 'Fn::GetAtt': [name, field] });
const resource = (Type, Properties, extra = {}) => ({ Type, Properties, ...extra });
const tags = [{ Key: 'Project', Value: 'CompliancePlatformDemo' }];

export function artifactTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: 'Private versioned synthetic demo artifact storage',
    Resources: {
      Artifacts: resource('AWS::S3::Bucket', {
        VersioningConfiguration: { Status: 'Enabled' },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        LifecycleConfiguration: { Rules: [{ Id: 'ExpireDemoBuilds', Status: 'Enabled', ExpirationInDays: 7, NoncurrentVersionExpiration: { NoncurrentDays: 7 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] },
        Tags: tags,
      }, { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' }),
      SecureTransport: resource('AWS::S3::BucketPolicy', { Bucket: ref('Artifacts'), PolicyDocument: {
        Version: '2012-10-17', Statement: [{ Effect: 'Deny', Principal: '*', Action: 's3:*',
          Resource: [get('Artifacts', 'Arn'), sub('${Artifacts.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } }],
      } }),
    }, Outputs: { Bucket: { Value: ref('Artifacts') } },
  };
}

export function applicationTemplate(bootstrap) {
  const parameters = {
    ArtifactBucket: { Type: 'String', AllowedPattern: '[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]' },
    ArtifactKey: { Type: 'String', AllowedPattern: 'builds/[a-f0-9]{64}\\.tar\\.gz' },
    ArtifactVersion: { Type: 'String', AllowedPattern: '[A-Za-z0-9._/+=-]+' },
    ArtifactSha256: { Type: 'String', AllowedPattern: '[a-f0-9]{64}' },
    DemoDomain: { Type: 'String', AllowedPattern: '[a-z0-9]+([.-][a-z0-9]+)+', MaxLength: 253 },
    HostedZoneId: { Type: 'AWS::Route53::HostedZone::Id' },
    CertificateArn: { Type: 'String', AllowedPattern: 'arn:aws:acm:[a-z0-9-]+:[0-9]{12}:certificate/[a-f0-9-]+' },
    SignInDomainPrefix: { Type: 'String', AllowedPattern: '[a-z0-9]+(-[a-z0-9]+)*', MinLength: 3, MaxLength: 63 },
    Scenario: { Type: 'String', Default: 'va-ssa', AllowedValues: ['va-ssa', 'va-audit'] },
    GatewayPort: { Type: 'Number', Default: 5417, MinValue: 1024, MaxValue: 65000 },
    RunHours: { Type: 'Number', Default: 4, MinValue: 1, MaxValue: 12 },
    ImageId: { Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>', Default: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64' },
  };
  const resources = {
    Vpc: resource('AWS::EC2::VPC', { CidrBlock: '10.73.0.0/16', EnableDnsSupport: true, EnableDnsHostnames: true, Tags: tags }),
    InternetGateway: resource('AWS::EC2::InternetGateway', { Tags: tags }),
    Attachment: resource('AWS::EC2::VPCGatewayAttachment', { VpcId: ref('Vpc'), InternetGatewayId: ref('InternetGateway') }),
    RouteTable: resource('AWS::EC2::RouteTable', { VpcId: ref('Vpc') }),
    InternetRoute: resource('AWS::EC2::Route', { RouteTableId: ref('RouteTable'), DestinationCidrBlock: '0.0.0.0/0', GatewayId: ref('InternetGateway') }, { DependsOn: 'Attachment' }),
    BalancerSecurity: resource('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Public HTTPS only', VpcId: ref('Vpc'),
      SecurityGroupIngress: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' }],
      // ALB needs outbound HTTPS for the Cognito token endpoint and 8080 to its target.
      SecurityGroupEgress: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' }, { IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, CidrIp: '10.73.0.0/16' }],
    }),
    InstanceSecurity: resource('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Proxy reachable only through the authenticated ALB', VpcId: ref('Vpc'),
      SecurityGroupIngress: [{ IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, SourceSecurityGroupId: ref('BalancerSecurity') }],
      SecurityGroupEgress: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' }],
    }),
    InstanceRole: resource('AWS::IAM::Role', {
      AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
      ManagedPolicyArns: [sub('arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore')],
      Policies: [{ PolicyName: 'ReadThisBuild', PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObjectVersion', Resource: sub('arn:${AWS::Partition}:s3:::${ArtifactBucket}/${ArtifactKey}'), Condition: { StringEquals: { 's3:VersionId': ref('ArtifactVersion') } } }] } }],
    }),
    InstanceProfile: resource('AWS::IAM::InstanceProfile', { Roles: [ref('InstanceRole')] }),
    Instance: resource('AWS::EC2::Instance', {
      ImageId: ref('ImageId'), InstanceType: 't3.small', IamInstanceProfile: ref('InstanceProfile'),
      MetadataOptions: { HttpTokens: 'required', HttpPutResponseHopLimit: 1 },
      NetworkInterfaces: [{ AssociatePublicIpAddress: true, DeviceIndex: '0', SubnetId: ref('Subnet0'), GroupSet: [ref('InstanceSecurity')] }],
      BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeSize: 16, VolumeType: 'gp3', Encrypted: true, DeleteOnTermination: true } }],
      CreditSpecification: { CPUCredits: 'standard' }, InstanceInitiatedShutdownBehavior: 'stop',
      UserData: { 'Fn::Base64': sub(bootstrap) }, Tags: [...tags, { Key: 'Name', Value: sub('${AWS::StackName}-demo') }],
    }, { DependsOn: ['InternetRoute', 'SubnetRoute0'] }),
    UserPool: resource('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, UsernameAttributes: ['email'], AutoVerifiedAttributes: ['email'],
      Policies: { PasswordPolicy: { MinimumLength: 12, RequireLowercase: true, RequireUppercase: true, RequireNumbers: true, RequireSymbols: true } },
    }),
    UserPoolDomain: resource('AWS::Cognito::UserPoolDomain', { Domain: ref('SignInDomainPrefix'), UserPoolId: ref('UserPool') }),
    UserPoolClient: resource('AWS::Cognito::UserPoolClient', {
      UserPoolId: ref('UserPool'), GenerateSecret: true, AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'], AllowedOAuthScopes: ['openid', 'email'], SupportedIdentityProviders: ['COGNITO'],
      CallbackURLs: [sub('https://${DemoDomain}/oauth2/idpresponse')], PreventUserExistenceErrors: 'ENABLED',
    }),
    LoadBalancer: resource('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing', Type: 'application', Subnets: [ref('Subnet0'), ref('Subnet1')], SecurityGroups: [ref('BalancerSecurity')],
      LoadBalancerAttributes: [{ Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' }], Tags: tags,
    }, { DependsOn: 'Attachment' }),
    Targets: resource('AWS::ElasticLoadBalancingV2::TargetGroup', {
      VpcId: ref('Vpc'), Protocol: 'HTTP', Port: 8080, TargetType: 'instance', Targets: [{ Id: ref('Instance') }], HealthCheckPath: '/healthz',
    }),
    Listener: resource('AWS::ElasticLoadBalancingV2::Listener', {
      LoadBalancerArn: ref('LoadBalancer'), Protocol: 'HTTPS', Port: 443, Certificates: [{ CertificateArn: ref('CertificateArn') }],
      SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06', DefaultActions: [
        { Type: 'authenticate-cognito', Order: 1, AuthenticateCognitoConfig: { UserPoolArn: get('UserPool', 'Arn'), UserPoolClientId: ref('UserPoolClient'), UserPoolDomain: ref('UserPoolDomain'), OnUnauthenticatedRequest: 'authenticate', Scope: 'openid email', SessionTimeout: 3600 } },
        { Type: 'forward', Order: 2, TargetGroupArn: ref('Targets') },
      ],
    }),
    Dns: resource('AWS::Route53::RecordSet', { HostedZoneId: ref('HostedZoneId'), Name: ref('DemoDomain'), Type: 'A', AliasTarget: { DNSName: get('LoadBalancer', 'DNSName'), HostedZoneId: get('LoadBalancer', 'CanonicalHostedZoneID') } }),
  };
  for (let index = 0; index < 2; index++) {
    resources[`Subnet${index}`] = resource('AWS::EC2::Subnet', { VpcId: ref('Vpc'), CidrBlock: `10.73.${index}.0/24`, AvailabilityZone: { 'Fn::Select': [index, { 'Fn::GetAZs': '' }] } });
    resources[`SubnetRoute${index}`] = resource('AWS::EC2::SubnetRouteTableAssociation', { SubnetId: ref(`Subnet${index}`), RouteTableId: ref('RouteTable') });
  }
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'Synthetic demo: ALB Cognito sign-in, existing loopback services on EC2. Billable, not production.', Parameters: parameters, Resources: resources,
    Outputs: { Url: { Value: sub('https://${DemoDomain}') }, InstanceId: { Value: ref('Instance') }, UserPoolId: { Value: ref('UserPool') }, TargetGroupArn: { Value: ref('Targets') }, Limitations: { Value: 'Synthetic shared demo operator; no per-reviewer application identity. EC2 auto-stop does not stop ALB or storage charges.' } } };
}
