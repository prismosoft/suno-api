import { NextResponse, NextRequest } from "next/server";
import { cookies } from 'next/headers'
import { sunoApi } from "@/lib/SunoApi";
import { corsHeaders } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url);
      const personaId = url.searchParams.get('id');
      const page = url.searchParams.get('page');

      if (personaId == null) {
        return new NextResponse(JSON.stringify({ error: 'Missing parameter id' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      const pageNumber = page ? parseInt(page) : 1;
      const personaInfo = await (await sunoApi((await cookies()).toString())).getPersonaPaginated(personaId, pageNumber);

      return new NextResponse(JSON.stringify(personaInfo), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      console.error('Error fetching persona:', error);

      return new NextResponse(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } else {
    return new NextResponse('Method Not Allowed', {
      headers: {
        Allow: 'GET',
        ...corsHeaders
      },
      status: 405
    });
  }
}

export async function POST(req: NextRequest) {
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { root_clip_id, name, description, is_public, user_input_styles } = body;

      if (!root_clip_id) {
        return new NextResponse(JSON.stringify({ error: 'root_clip_id is required' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      if (!name) {
        return new NextResponse(JSON.stringify({ error: 'name is required' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      const persona = await (await sunoApi((await cookies()).toString())).createPersona(
        root_clip_id,
        name,
        description,
        Boolean(is_public),
        user_input_styles
      );

      return new NextResponse(JSON.stringify(persona), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error: any) {
      console.error('Error creating persona:', error);
      return new NextResponse(JSON.stringify({ error: error.response?.data?.detail || error.message || 'Internal server error' }), {
        status: error.response?.status || 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } else {
    return new NextResponse('Method Not Allowed', {
      headers: {
        Allow: 'POST',
        ...corsHeaders
      },
      status: 405
    });
  }
}

export async function PUT(req: NextRequest) {
  if (req.method === 'PUT') {
    try {
      const body = await req.json();
      const { persona_id, name, description, is_public } = body;

      if (!persona_id) {
        return new NextResponse(JSON.stringify({ error: 'persona_id is required' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      const persona = await (await sunoApi((await cookies()).toString())).updatePersona(
        persona_id,
        name,
        description,
        is_public !== undefined ? Boolean(is_public) : undefined
      );

      return new NextResponse(JSON.stringify(persona), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error: any) {
      console.error('Error updating persona:', error);
      return new NextResponse(JSON.stringify({ error: error.response?.data?.detail || error.message || 'Internal server error' }), {
        status: error.response?.status || 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } else {
    return new NextResponse('Method Not Allowed', {
      headers: {
        Allow: 'PUT',
        ...corsHeaders
      },
      status: 405
    });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
}