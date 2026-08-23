import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const ShareRedirect = () => {
  const { campaignId, token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (campaignId && token) {
      // Redirect to campaign with token as URL parameter
      navigate(`/campaign/${campaignId}?token=${token}`, { replace: true });
    } else {
      // If missing parameters, redirect to campaigns list
      navigate('/campaigns', { replace: true });
    }
  }, [campaignId, token, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-muted-foreground">Accessing campaign...</span>
      </div>
    </div>
  );
};

export default ShareRedirect;