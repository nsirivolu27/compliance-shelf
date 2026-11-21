import { applicationTemplate } from './template.mjs';
const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const get = (name, field) => ({ 'Fn::GetAtt': [name, field] });
const resource = (Type, Properties, extra = {}) => ({ Type, Properties, ...extra });

export function cloudfrontTemplate(bootstrap, authCode) {
  const stack = applicationTemplate(bootstrap.replace(" '${DemoDomain}'", " ''"));
  stack.Description = 'Synthetic password-protected CloudFront demo, private EC2 origin, no purchased domain.';
  for (const key of ['DemoDomain', 'HostedZoneId', 'CertificateArn', 'SignInDomainPrefix']) delete stack.Parameters[key];
  stack.Parameters.DemoAuthHash = { Type: 'String', NoEcho: true, AllowedPattern: '[a-f0-9]{64}' };
  stack.Parameters.CloudFrontPrefixList = { Type: 'String', AllowedPattern: 'pl-[a-f0-9]+' };
  const r = stack.Resources;
  for (const name of ['BalancerSecurity', 'UserPool', 'UserPoolClient', 'UserPoolDomain', 'LoadBalancer', 'Targets', 'Listener', 'Dns', 'Subnet1', 'SubnetRoute1']) delete r[name];
  r.PrivateSubnet = resource('AWS::EC2::Subnet', { VpcId: ref('Vpc'), CidrBlock: '10.73.2.0/24', AvailabilityZone: get('Subnet0', 'AvailabilityZone'), MapPublicIpOnLaunch: false });
  r.NatAddress = resource('AWS::EC2::EIP', { Domain: 'vpc' }, { DependsOn: 'Attachment' });
  r.Nat = resource('AWS::EC2::NatGateway', { SubnetId: ref('Subnet0'), AllocationId: get('NatAddress', 'AllocationId') }, { DependsOn: 'InternetRoute' });
  r.PrivateRoutes = resource('AWS::EC2::RouteTable', { VpcId: ref('Vpc') });
  r.PrivateRoute = resource('AWS::EC2::Route', { RouteTableId: ref('PrivateRoutes'), DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: ref('Nat') });
  r.PrivateAssociation = resource('AWS::EC2::SubnetRouteTableAssociation', { RouteTableId: ref('PrivateRoutes'), SubnetId: ref('PrivateSubnet') });
  r.Instance.Properties.NetworkInterfaces[0].SubnetId = ref('PrivateSubnet');
  r.Instance.Properties.NetworkInterfaces[0].AssociatePublicIpAddress = false;
  r.Instance.DependsOn = ['PrivateRoute', 'PrivateAssociation'];
  r.InstanceSecurity.Properties.GroupDescription = 'CloudFront only; no public IP or direct app ingress';
  r.InstanceSecurity.Properties.SecurityGroupIngress = [{ IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, SourcePrefixListId: ref('CloudFrontPrefixList') }];
  r.VpcOrigin = resource('AWS::CloudFront::VpcOrigin', { VpcOriginEndpointConfig: {
    Name: sub('${AWS::StackName}-origin'), Arn: sub('arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${Instance}'),
    HTTPPort: 8080, HTTPSPort: 443, OriginProtocolPolicy: 'http-only', OriginSSLProtocols: ['TLSv1.2'],
  } });
  r.DemoAuth = resource('AWS::CloudFront::Function', {
    Name: sub('${AWS::StackName}-signin'), AutoPublish: true,
    FunctionConfig: { Comment: 'Shared synthetic demo password; not per-user agency authorization', Runtime: 'cloudfront-js-2.0' },
    FunctionCode: sub(authCode.replace('__AUTH_HASH__', '${DemoAuthHash}')),
  });
  r.Distribution = resource('AWS::CloudFront::Distribution', { DistributionConfig: {
    Enabled: true, Comment: 'Compliance Platform synthetic demo', PriceClass: 'PriceClass_100', HttpVersion: 'http2',
    ViewerCertificate: { CloudFrontDefaultCertificate: true },
    Origins: [{ Id: 'demo', DomainName: get('Instance', 'PrivateDnsName'), VpcOriginConfig: { VpcOriginId: get('VpcOrigin', 'Id'), OriginReadTimeout: 60 } }],
    DefaultCacheBehavior: {
      TargetOriginId: 'demo', ViewerProtocolPolicy: 'redirect-to-https', Compress: true,
      AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'], CachedMethods: ['GET', 'HEAD'],
      CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
      OriginRequestPolicyId: '216adef6-5c7f-47e4-b989-5492eafa07d3',
      FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: get('DemoAuth', 'FunctionMetadata.FunctionARN') }],
    },
    CustomErrorResponses: [400, 403, 404, 500, 502, 503, 504].map(ErrorCode => ({ ErrorCode, ErrorCachingMinTTL: 0 })),
  } });
  stack.Outputs = {
    Url: { Value: sub('https://${Distribution.DomainName}') },
    Domain: { Value: get('Distribution', 'DomainName') },
    InstanceId: { Value: ref('Instance') },
    DistributionId: { Value: ref('Distribution') },
    AuthFunctionName: { Value: ref('DemoAuth') },
    Limitations: { Value: 'Shared demo password, synthetic data, local-demo-operator audit identity. NAT and storage continue consuming credits after EC2 stops.' },
  };
  return stack;
}
